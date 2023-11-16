import util from "util";
import cp from "child_process";
import prettyHrtime from "pretty-hrtime";
import chalk from "chalk";
import path from "path";
import plimit from "p-limit";
import AdmZip from "adm-zip";
import { readFileSync } from "fs";

// SupportedRuntimes Runtimes that are allowed to run Golang lambdas.
const supportedRuntimes = ["provided.al2"];

const logPrefix = "GoPlugin";

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
      },
      cmd: 'go build -ldflags="-s -w"',
      monorepo: false,
      concurrency: 5,
    };

    this.config = this.getConfig();

    this.hooks = {
      "before:deploy:function:packageFunction": this.compileFunction.bind(this),
      "before:package:createDeploymentArtifacts":
        this.compileFunctions.bind(this),
      // Because of https://github.com/serverless/serverless/blob/master/lib/plugins/aws/invokeLocal/index.js#L361
      // plugin needs to compile a function and then ignore packaging.
      "before:invoke:local:invoke": this.compileToInvoke.bind(this),
      "go:build:build": this.compileFunctions.bind(this),
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
   * Execute single function compilation and package.
   */
  async compileFunction() {
    const name = this.options.function;
    const func = this.serverless.service.functions[this.options.function];

    this.logInfo(`Starting compilation...`);

    const timeStart = process.hrtime();
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
   * Execute single function compilation and do not create the final artifact.
   * This is used when `invoke` command is performed.
   */
  async compileToInvoke() {
    const name = this.options.function;
    const func = this.serverless.service.functions[this.options.function];

    this.logInfo(`Starting compilation...`);

    const timeStart = process.hrtime();
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

    if (arch == "arm64") {
      config.env["GOARCH"] = "arm64";
    }

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

    this.logDebug(`[${name}] env: ${JSON.stringify(config.env)}`);
    this.logDebug(`[${name}] cwd: ${cwd}`);
    this.logDebug(`[${name}] arch: ${arch}`);

    await this.execCompilation(
      config.cmd,
      compileBinPath,
      handler,
      cwd,
      config.env,
      arch,
    );

    this.logInfo(`Compiled function: ${chalk.magenta(name)}`);

    let binPath = path.join(config.binDir, name);

    if (process.platform === "win32") {
      binPath = binPath.replace(/\\/g, "/");
    }

    this.serverless.service.functions[name].handler = binPath;

    if (artifact) {
      this.packageBootstrap(name, binPath);
    }
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
   * Create package to deploy lambda
   *
   * @param {string} name Name of the function config
   * @param {Object} baseConfig Configuration object
   * @param {string} binPath Path to generated binary
   */
  packageBootstrap(name, binPath) {
    this.zip.addFile("bootstrap", this.readFileSync(binPath), "", 0o755);

    const zipPath = binPath + ".zip";
    this.zip.writeZip(zipPath);

    this.serverless.service.functions[name].package = {
      individually: true,
      artifact: zipPath,
    };
  }

  /**
   * Merge default con
   * @returns {Object}
   */
  getConfig() {
    let config = { ...this.defaultConfig };
    const service = this.serverless.service;

    if (service.custom && service.custom.go) {
      config = { ...config, ...service.custom.go };
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
