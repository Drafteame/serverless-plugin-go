import util from "util";
import cp from "child_process";
import prettyHrtime from "pretty-hrtime";
import chalk from "chalk";
import path from "path";
import plimit from "p-limit";
import AdmZip from "adm-zip";
import { readFileSync, statSync } from "fs";
import { createHash } from "crypto";
import { createTracer } from "./trace.js";

// SupportedRuntimes Runtimes that are allowed to run Golang lambdas.
const supportedRuntimes = ["provided.al2", "provided.al2023"];

const logPrefix = "GoPlugin";

// DOS zip timestamps can't go before 1980.
const zipEpoch = new Date(1980, 0, 1);

export default class Go {
  constructor(serverless, options) {
    this.readFileSync = readFileSync;
    this.zip = new AdmZip();
    this.exec = util.promisify(cp.exec);

    this.serverless = serverless;
    this.options = options || {};

    this.defaultConfig = {
      baseDir: ".",
      binDir: ".bin",
      env: {
        CGO_ENABLED: "0",
        GOOS: "linux",
        GOFLAGS: "-trimpath -buildvcs=false", // reproducible builds
      },
      cmd: 'go build -ldflags="-s -w"',
      monorepo: false,
      concurrency: 5,
      beforeBuild: [],
    };

    this.config = this.getConfig();
    this.tracer = createTracer(process.env, this.traceResource());

    this.hooks = {
      "before:deploy:function:packageFunction": this.traced(
        "go.build",
        this.compileFunction,
      ),
      "before:package:createDeploymentArtifacts": this.traced(
        "go.build",
        this.compileFunctions,
      ),

      // Because of https://github.com/serverless/serverless/blob/master/lib/plugins/aws/invokeLocal/index.js#L361
      // plugin needs to compile a function and then ignore packaging.
      "before:invoke:local:invoke": this.traced(
        "go.build",
        this.compileToInvoke,
      ),
      "go:build:build": this.traced("go.build", this.compileFunctions),
    };

    this.commands = {
      go: {
        usage: "Manage Go functions",
        lifecycleEvents: ["go"],
        commands: {
          build: {
            usage: "Build all Go functions",
            lifecycleEvents: ["build"],
          },
        },
      },
    };
  }

  /**
   * Static metadata attached to every exported span (only used when SP_GO_TRACE is on).
   */
  traceResource() {
    return {
      "service.version": JSON.parse(
        readFileSync(new URL("./package.json", import.meta.url)),
      ).version,
      "process.runtime.version": process.version,
      "host.arch": process.arch,
      "os.type": process.platform,
      "sls.service": this.serverless.service.service,
    };
  }

  /**
   * Wrap a hook in a root span and export the trace when it finishes.
   */
  traced(name, fn) {
    return async (...args) => {
      try {
        return await this.tracer.span(name, {}, async (s) => {
          if (s.enabled) {
            s.set(
              "go.functions",
              Object.keys(this.serverless.service.functions).length,
            );
            s.set("go.concurrency", this.config.concurrency);
            s.set("go.monorepo", Boolean(this.config.monorepo));
            s.set("go.version", await this.goVersion());
          }
          return fn.apply(this, args);
        });
      } finally {
        await this.tracer.flush((msg) => this.logDebug(msg));
      }
    };
  }

  async goVersion() {
    try {
      return (await this.exec("go version")).stdout.trim();
    } catch (e) {
      return "unknown";
    }
  }

  /**
   * Execute a single function compilation and package.
   */
  async compileFunction() {
    const name = this.options.function;
    const func = this.serverless.service.functions[this.options.function];

    this.logInfo(`Starting compilation...`);

    const timeStart = process.hrtime();

    // Execute beforeBuild commands once before compilation
    await this.execBeforeBuildCommands(this.config.baseDir, this.config.env);

    await this.compile(name, func);
    const timeEnd = process.hrtime(timeStart);

    this.logInfo(`Compilation time (${name}): ${prettyHrtime(timeEnd)}`);
  }

  /**
   * Load all configured functions and execute compilation according it's configuration.
   */
  async compileFunctions() {
    let names = Object.keys(this.serverless.service.functions);

    this.logInfo(`Starting compilation...`);

    const timeStart = process.hrtime();

    // Execute beforeBuild commands once before all compilations
    await this.execBeforeBuildCommands(this.config.baseDir, this.config.env);

    this.logDebug(`using concurrency limit ${this.config.concurrency}...`);

    const limit = plimit(this.config.concurrency);

    let compiles = names.map((funcName) => {
      const func = this.serverless.service.functions[funcName];
      return limit(() => this.compile(funcName, func));
    });

    await Promise.all(compiles);

    const timeEnd = process.hrtime(timeStart);

    this.logInfo(`Compilation time: ${prettyHrtime(timeEnd)}`);
  }

  /**
   * Execute a single function compilation and do not create the final artifact.
   * This is used when the ` invoke ` command is performed.
   */
  async compileToInvoke() {
    const name = this.options.function;
    const func = this.serverless.service.functions[this.options.function];

    this.logInfo(`Starting compilation...`);

    const timeStart = process.hrtime();

    // Execute beforeBuild commands once before compilation
    await this.execBeforeBuildCommands(this.config.baseDir, this.config.env);

    await this.compile(name, func, false);
    const timeEnd = process.hrtime(timeStart);

    this.logInfo(`Compilation time (${name}): ${prettyHrtime(timeEnd)}`);
  }

  /**
   * Collect configuration to build binaries and create the final artifact if needed
   *
   * @param {string} name name of the node function
   * @param {Object} func function configuration object
   * @param {bool} artifact flag to create or not the final artifact
   *
   * @throws {Error} if compilation command fails
   */
  async compile(name, func, artifact = true) {
    const config = this.config;
    const arch = this.getFunctionArch(name);
    const runtime = this.getFunctionRuntime(name);

    if (!supportedRuntimes.includes(runtime)) {
      return;
    }

    // Per-function env: never mutate shared config, and always set GOARCH so the
    // host arch (e.g. Apple Silicon) never leaks into an x86_64 Lambda.
    const env = {
      ...config.env,
      GOARCH: arch === "arm64" ? "arm64" : "amd64",
    };

    const absHandler = path.resolve(config.baseDir);
    const absBin = path.resolve(config.binDir);

    let compileBinPath = path.join(path.relative(absHandler, absBin), name); // binPath is based on cwd no baseDir
    let cwd = config.baseDir;
    let handler = func.handler;

    if (config.monorepo) {
      cwd = path.relative(absHandler, func.handler);
      handler = ".";

      if (func.handler.endsWith(".go")) {
        cwd = path.relative(absHandler, path.dirname(func.handler));
        handler = path.basename(func.handler);
      }

      compileBinPath = path.relative(cwd, compileBinPath);
    }

    this.logDebug(`[${name}] env: ${JSON.stringify(env)}`);
    this.logDebug(`[${name}] cwd: ${cwd}`);
    this.logDebug(`[${name}] arch: ${arch}`);

    let binPath = path.join(config.binDir, name);

    if (process.platform === "win32") {
      binPath = binPath.replace(/\\/g, "/");
    }

    // The build command itself is not traced: -ldflags may embed secrets.
    await this.tracer.span(
      "go.compile",
      {
        "go.function": name,
        "go.os": env.GOOS,
        "go.arch": env.GOARCH,
        "go.flags": env.GOFLAGS,
        "go.cgo": env.CGO_ENABLED,
        "faas.runtime": runtime,
      },
      async (s) => {
        await this.execCompilation(
          config.cmd,
          compileBinPath,
          handler,
          cwd,
          env,
          arch,
        );
        this.setFileAttrs(s, "go.binary", binPath);
      },
    );

    this.logInfo(`Compiled function: ${chalk.magenta(name)}`);

    this.serverless.service.functions[name].handler = binPath;

    if (artifact) {
      this.packageBootstrap(name, binPath);
    }
  }

  /**
   * Execute bash commands from beforeBuild configuration.
   *
   * @param {string} cwd Working directory
   * @param {Object} env Set of environment variables
   */
  async execBeforeBuildCommands(cwd, env) {
    if (!this.config.beforeBuild || !this.config.beforeBuild.length) {
      return;
    }

    const execOpts = { cwd: cwd, env: { ...process.env, ...env } };

    // Only the command count is traced, never the commands (they may hold secrets).
    await this.tracer.span(
      "go.before_build",
      { "go.before_build.commands": this.config.beforeBuild.length },
      async () => {
        for (const cmd of this.config.beforeBuild) {
          this.logDebug(`Executing beforeBuild command: ${cmd}`);
          try {
            await this.exec(cmd, execOpts);
          } catch (e) {
            this.logError(
              `Error executing beforeBuild command (cwd: ${cwd}): ${e.message}`,
            );
            throw new Error(
              `error executing beforeBuild command '${cmd}' (cwd: ${cwd})`,
            );
          }
        }
      },
    );
  }

  /**
   * Execute compilation command from collected configuration.
   *
   * @param {string} cmd Compilation command
   * @param {string} out Binary out path
   * @param {string} main Path to the main package or file
   * @param {string} cwd Working directory
   * @param {Object} env Set of environment variables to execute compilation
   * @param {string} arch Compilation architecture
   */
  async execCompilation(cmd, out, main, cwd, env, arch) {
    let command = `${cmd} -o ${out} ${main}`;

    let execOpts = { cwd: cwd, env: { ...process.env, ...env } };

    try {
      await this.exec(command, execOpts);
    } catch (e) {
      this.logError(`Error compiling function (cwd: ${cwd}): ${e.message}`);

      throw new Error(`error compiling function (cwd: ${cwd})`);
    }
  }

  /**
   * Packages a bootstrap file into a zip archive and updates the service function's package configuration.
   *
   * @param {string} name - The name of the serverless function to update the package for.
   * @param {string} binPath - The path to the bootstrap binary file.
   * @return {void} This method does not return any value.
   */
  packageBootstrap(name, binPath) {
    this.tracer.span("go.package", { "go.function": name }, (s) => {
      this.zip.addFile("bootstrap", this.readFileSync(binPath), "", 0o755);
      // Fixed mtime so identical binaries produce byte-identical zips (stable hashes).
      this.zip.getEntry("bootstrap").header.time = zipEpoch;

      const zipPath = binPath + ".zip";
      this.zip.writeZip(zipPath);

      this.serverless.service.functions[name].package = {
        individually: true,
        artifact: zipPath,
      };
      this.setFileAttrs(s, "go.artifact", zipPath);
    });
  }

  /**
   * Add size and sha256 of a file to a span (no-op, and no file read, when tracing is off).
   */
  setFileAttrs(span, prefix, file) {
    if (!span.enabled) return;
    try {
      span.set(`${prefix}.size`, statSync(file).size);
      span.set(
        `${prefix}.sha256`,
        createHash("sha256").update(readFileSync(file)).digest("hex"),
      );
    } catch (e) {
      this.logDebug(`could not read ${file} for tracing: ${e.message}`);
    }
  }

  /**
   * Retrieves and consolidates the configuration by merging the default configuration
   * with user-defined custom configurations and environment variables.
   *
   * @return {Object} The final configuration object containing merged settings,
   *                  environment variables as strings, and concurrency settings.
   */
  getConfig() {
    let config = { ...this.defaultConfig };
    const service = this.serverless.service;

    if (service.custom && service.custom.go) {
      config = {
        ...config,
        ...service.custom.go,
        env: { ...config.env, ...service.custom.go.env },
      };
    }

    for (let env of Object.keys(config.env)) {
      config.env[env] = `${config.env[env]}`;
    }

    config.concurrency =
      parseInt(process.env.SP_GO_CONCURRENCY) || config.concurrency;

    return config;
  }

  /**
   * Read provider and function configuration and return the compilation architecture
   *
   * @param {string} funcName Function name to get compilation architecture.
   *
   * @returns Architecture name
   */
  getFunctionArch(funcName) {
    const funcConf = this.serverless.service.functions[funcName];
    const provider = this.serverless.service.provider;

    let arch = provider.architecture || "x86_64";

    if (funcConf.architecture) {
      arch = funcConf.architecture;
    }

    return arch;
  }

  /**
   * Check provider and function architecture and determine the compilation arch
   *
   * @param {string} funcName Function name to collect architecture
   *
   * @returns architecture name
   */
  getFunctionRuntime(funcName) {
    const funcConf = this.serverless.service.functions[funcName];
    const provider = this.serverless.service.provider;

    let runtime = provider.runtime;

    if (funcConf.runtime) {
      runtime = funcConf.runtime;
    }

    return runtime;
  }

  /**
   * Print a plugin debug log message
   *
   * @param {string} message Log message
   */
  logDebug(message) {
    if (!this.options.verbose) {
      return;
    }

    this.serverless.cli.consoleLog(`${chalk.yellow(logPrefix)}: ${message}`);
  }

  /**
   * Print a plugin info log message
   *
   * @param {string} message Log message
   */
  logInfo(message) {
    this.serverless.cli.consoleLog(`${chalk.cyan(logPrefix)}: ${message}`);
  }

  /**
   * Print a plugin error log message
   *
   * @param {string} message Log message
   */
  logError(message) {
    this.serverless.cli.consoleLog(`${chalk.red(logPrefix)}: ${message}`);
  }
}
