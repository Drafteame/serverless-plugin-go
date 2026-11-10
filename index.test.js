import sinon from "sinon";
import chai from "chai";
import sinonChai from "sinon-chai";

import AdmZip from "adm-zip";
import fs from "fs";
import os from "os";
import path from "path";

import Go from "./index.js";
import ServerlessMock from "./mocks/serverless.mock.js";

const expect = chai.expect;

chai.use(sinonChai);

describe("Go Plugin", () => {
  let config = new ServerlessMock();
  let sandbox;
  let execStub;
  let readFileSyncStub;
  let admZipStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    execStub = sandbox.stub().resolves({ stdin: null, stdout: null });
    readFileSyncStub = sinon
      .stub()
      .withArgs(".bin/testFunc1")
      .returns("fake binary content");

    admZipStub = {
      addFile: sinon.stub(),
      writeZip: sinon.stub(),
      getEntry: sinon.stub().returns({ header: {} }),
    };
  });

  afterEach(() => {
    config.service.restore();
    sandbox.restore();
  });

  it("Compiles only Go functions with allowed providers", async () => {
    config.service.setFunctions({
      testFunc1: {
        name: "testFunc1",
        runtime: "nodejs10.x",
        handler: "functions/func1",
      },
      testFunc2: {
        name: "testFunc2",
        runtime: "provided.al2",
        handler: "functions/func2/main.go",
      },
      testFunc3: {
        name: "testFunc3",
        runtime: "provided.al2",
        handler: "functions/func3",
      },
      testFunc4: {
        name: "testFunc4",
        runtime: "go1.x",
        handler: "functions/func4",
      },
      testFunc5: {
        name: "testFunc5",
        runtime: "provided.al2023",
        handler: "functions/func5/main.go",
      },
      testFunc6: {
        name: "testFunc6",
        runtime: "provided.al2023",
        handler: "functions/func6",
      },
    });

    const plugin = new Go(config);
    plugin.exec = execStub;
    plugin.readFileSync = readFileSyncStub;
    plugin.zip = admZipStub;

    // when
    await plugin.compileFunctions();

    // then
    expect(config.service.functions.testFunc2.handler).to.equal(
      `.bin/testFunc2`,
    );

    expect(execStub).to.have.been.calledWith(
      `go build -ldflags="-s -w" -o .bin/testFunc2 functions/func2/main.go`,
      {
        cwd: ".",
        env: {
          ...process.env,
          ...{ CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64" },
        },
      },
    );

    expect(config.service.functions.testFunc3.handler).to.equal(
      `.bin/testFunc3`,
    );

    expect(execStub).to.have.been.calledWith(
      `go build -ldflags="-s -w" -o .bin/testFunc3 functions/func3`,
      {
        cwd: ".",
        env: {
          ...process.env,
          ...{ CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64" },
        },
      },
    );

    expect(config.service.functions.testFunc5.handler).to.equal(
      `.bin/testFunc5`,
    );

    expect(execStub).to.have.been.calledWith(
      `go build -ldflags="-s -w" -o .bin/testFunc5 functions/func5/main.go`,
      {
        cwd: ".",
        env: {
          ...process.env,
          ...{ CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64" },
        },
      },
    );

    expect(config.service.functions.testFunc6.handler).to.equal(
      `.bin/testFunc6`,
    );

    expect(execStub).to.have.been.calledWith(
      `go build -ldflags="-s -w" -o .bin/testFunc6 functions/func6`,
      {
        cwd: ".",
        env: {
          ...process.env,
          ...{ CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64" },
        },
      },
    );
  });

  it("Compiles Go function with custom command", async () => {
    config.service
      .setCustom({
        go: {
          cmd: "go build",
        },
      })
      .setFunctions({
        testFunc1: {
          name: "testFunc1",
          runtime: "provided.al2",
          handler: "functions/func1/main.go",
        },
      });

    const plugin = new Go(config);
    plugin.exec = execStub;
    plugin.readFileSync = readFileSyncStub;
    plugin.zip = admZipStub;

    // when
    await plugin.compileFunctions();

    // then
    expect(execStub).to.have.been.calledOnceWith(
      `go build -o .bin/testFunc1 functions/func1/main.go`,
      {
        cwd: ".",
        env: {
          ...process.env,
          ...{ CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64" },
        },
      },
    );
  });

  it("Compiles Go function with arm architecture", async () => {
    config.service
      .setProvider({
        architecture: "arm64",
      })
      .setFunctions({
        testFunc1: {
          name: "testFunc1",
          runtime: "provided.al2",
          handler: "functions/func1/main.go",
        },
      });

    const plugin = new Go(config);
    plugin.exec = execStub;
    plugin.readFileSync = readFileSyncStub;
    plugin.zip = admZipStub;

    // when
    await plugin.compileFunctions();

    // then
    expect(execStub).to.have.been.calledOnceWith(
      `go build -ldflags="-s -w" -o .bin/testFunc1 functions/func1/main.go`,
      {
        cwd: ".",
        env: {
          ...process.env,
          ...{ CGO_ENABLED: "0", GOOS: "linux", GOARCH: "arm64" },
        },
      },
    );
  });

  it("Compiles Go function with custom base dir", async () => {
    config.service
      .setCustom({
        go: {
          baseDir: "gopath",
        },
      })
      .setFunctions({
        testFunc1: {
          name: "testFunc1",
          runtime: "provided.al2",
          handler: "functions/func1/main.go",
        },
      });

    const plugin = new Go(config);
    plugin.exec = execStub;
    plugin.readFileSync = readFileSyncStub;
    plugin.zip = admZipStub;

    // when
    await plugin.compileFunctions();

    // then
    expect(execStub).to.have.been.calledOnceWith(
      `go build -ldflags="-s -w" -o ../.bin/testFunc1 functions/func1/main.go`,
      {
        cwd: "gopath",
        env: {
          ...process.env,
          ...{ CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64" },
        },
      },
    );
  });

  it("Throw error if compilation fails", async () => {
    execStub.throws();

    config.service.setFunctions({
      testFunc1: {
        name: "testFunc1",
        runtime: "provided.al2",
        handler: "functions/func1/main.go",
      },
    });

    const plugin = new Go(config);
    plugin.exec = execStub;
    plugin.readFileSync = readFileSyncStub;
    plugin.zip = admZipStub;

    try {
      await plugin.compileFunctions();
    } catch (e) {
      expect(e.message).to.equal(`error compiling function (cwd: .)`);
      return;
    }

    expect.fail("Expected to throw an Error");
  });

  it("Compiles Go function with global runtime defined", async () => {
    config.service
      .setProvider({
        runtime: "provided.al2",
      })
      .setFunctions({
        testFunc1: {
          name: "testFunc1",
          handler: "functions/func1/main.go",
        },
      });

    const plugin = new Go(config);
    plugin.exec = execStub;
    plugin.readFileSync = readFileSyncStub;
    plugin.zip = admZipStub;

    // when
    await plugin.hooks["before:package:createDeploymentArtifacts"]();

    // then
    expect(execStub).to.have.been.calledOnce;
  });

  it("Compiles Go function with global runtime provided.al2023 defined", async () => {
    config.service
      .setProvider({
        runtime: "provided.al2023",
      })
      .setFunctions({
        testFunc1: {
          name: "testFunc1",
          handler: "functions/func1/main.go",
        },
      });

    const plugin = new Go(config);
    plugin.exec = execStub;
    plugin.readFileSync = readFileSyncStub;
    plugin.zip = admZipStub;

    // when
    await plugin.hooks["before:package:createDeploymentArtifacts"]();

    // then
    expect(execStub).to.have.been.calledOnce;
  });

  it("Compiles single Go function", async () => {
    config.service.setFunctions({
      testFunc1: {
        name: "testFunc1",
        runtime: "provided.al2",
        handler: "functions/func1/main.go",
      },
    });

    const plugin = new Go(config, { function: "testFunc1" });
    plugin.exec = execStub;
    plugin.readFileSync = readFileSyncStub;
    plugin.zip = admZipStub;

    // when
    await plugin.hooks["before:deploy:function:packageFunction"]();

    // then
    expect(execStub).to.have.been.calledOnceWith(
      `go build -ldflags="-s -w" -o .bin/testFunc1 functions/func1/main.go`,
      {
        cwd: ".",
        env: {
          ...process.env,
          ...{ CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64" },
        },
      },
    );
  });

  it("Compiles Go function with monorepo", async () => {
    config.service
      .setCustom({
        go: {
          monorepo: true,
        },
      })
      .setFunctions({
        testFunc1: {
          name: "testFunc1",
          runtime: "provided.al2",
          handler: "functions/func1",
        },
        testFunc2: {
          name: "testFunc2",
          runtime: "provided.al2",
          handler: "functions/func2/main.go",
        },
      });

    const plugin = new Go(config);
    plugin.exec = execStub;
    plugin.readFileSync = readFileSyncStub;
    plugin.zip = admZipStub;

    // when
    await plugin.hooks["before:package:createDeploymentArtifacts"]();

    // then
    expect(config.service.functions.testFunc1.handler).to.equal(
      `.bin/testFunc1`,
    );

    expect(execStub).to.have.been.calledWith(
      `go build -ldflags="-s -w" -o ../../.bin/testFunc1 .`,
      {
        cwd: "functions/func1",
        env: {
          ...process.env,
          ...{ CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64" },
        },
      },
    );

    expect(config.service.functions.testFunc2.handler).to.equal(
      `.bin/testFunc2`,
    );

    expect(execStub).to.have.been.calledWith(
      `go build -ldflags="-s -w" -o ../../.bin/testFunc2 main.go`,
      {
        cwd: "functions/func2",
        env: {
          ...process.env,
          ...{ CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64" },
        },
      },
    );
  });

  it("Compiles Go functions", async () => {
    config.service.setFunctions({
      testFunc1: {
        name: "testFunc1",
        runtime: "provided.al2",
        handler: "functions/func2/main.go",
      },
    });

    const plugin = new Go(config);
    plugin.exec = execStub;
    plugin.readFileSync = readFileSyncStub;
    plugin.zip = admZipStub;

    // when
    await plugin.hooks["go:build:build"]();

    // then
    expect(config.service.functions.testFunc1.handler).to.equal(
      `.bin/testFunc1`,
    );
  });

  it("Should get concurrency config", async () => {
    config.service.setFunctions({
      testFunc1: {
        name: "testFunc1",
        runtime: "provided.al2",
        handler: "functions/func2/main.go",
      },
    });

    const plugin = new Go(config);

    expect(plugin.config.concurrency).to.be.equal(
      plugin.defaultConfig.concurrency,
    );
  });

  it("Should get concurrency from env vars", async () => {
    config.service.setFunctions({
      testFunc1: {
        name: "testFunc1",
        runtime: "provided.al2",
        handler: "functions/func2/main.go",
      },
    });

    process.env["SP_GO_CONCURRENCY"] = "10";

    const plugin = new Go(config);

    expect(plugin.config.concurrency).to.be.equal(10);

    delete process.env["SP_GO_CONCURRENCY"];
  });

  it("Should get default concurrency if env var can't be parsed", async () => {
    config.service.setFunctions({
      testFunc1: {
        name: "testFunc1",
        runtime: "provided.al2",
        handler: "functions/func2/main.go",
      },
    });

    process.env["SP_GO_CONCURRENCY"] = "something";

    const plugin = new Go(config);

    expect(plugin.config.concurrency).to.be.equal(
      plugin.defaultConfig.concurrency,
    );

    delete process.env["SP_GO_CONCURRENCY"];
  });

  it("Should execute beforeBuild commands once before all compilations", async () => {
    config.service
      .setCustom({
        go: {
          beforeBuild: ["echo 'before build command'", "go mod tidy"],
        },
      })
      .setFunctions({
        testFunc1: {
          name: "testFunc1",
          runtime: "provided.al2",
          handler: "functions/func1/main.go",
        },
        testFunc2: {
          name: "testFunc2",
          runtime: "provided.al2",
          handler: "functions/func2/main.go",
        },
      });

    const plugin = new Go(config);
    plugin.exec = execStub;
    plugin.readFileSync = readFileSyncStub;
    plugin.zip = admZipStub;

    // when
    await plugin.compileFunctions();

    // then
    // Verify beforeBuild commands were executed once
    expect(execStub).to.have.been.calledWith("echo 'before build command'", {
      cwd: ".",
      env: { ...process.env, ...{ CGO_ENABLED: "0", GOOS: "linux" } },
    });
    expect(execStub).to.have.been.calledWith("go mod tidy", {
      cwd: ".",
      env: { ...process.env, ...{ CGO_ENABLED: "0", GOOS: "linux" } },
    });

    // Verify compilation commands were executed for each function
    expect(execStub).to.have.been.calledWith(
      `go build -ldflags="-s -w" -o .bin/testFunc1 functions/func1/main.go`,
      {
        cwd: ".",
        env: {
          ...process.env,
          ...{ CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64" },
        },
      },
    );
    expect(execStub).to.have.been.calledWith(
      `go build -ldflags="-s -w" -o .bin/testFunc2 functions/func2/main.go`,
      {
        cwd: ".",
        env: {
          ...process.env,
          ...{ CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64" },
        },
      },
    );

    // Total calls should be 4: 2 beforeBuild commands + 2 compilation commands
    expect(execStub.callCount).to.equal(4);
  });

  it("Should execute beforeBuild commands once for compileFunction", async () => {
    config.service
      .setCustom({
        go: {
          beforeBuild: ["echo 'before build command'", "go mod tidy"],
        },
      })
      .setFunctions({
        testFunc1: {
          name: "testFunc1",
          runtime: "provided.al2",
          handler: "functions/func1/main.go",
        },
      });

    const plugin = new Go(config, { function: "testFunc1" });
    plugin.exec = execStub;
    plugin.readFileSync = readFileSyncStub;
    plugin.zip = admZipStub;

    // when
    await plugin.compileFunction();

    // then
    // Verify beforeBuild commands were executed once
    expect(execStub).to.have.been.calledWith("echo 'before build command'", {
      cwd: ".",
      env: { ...process.env, ...{ CGO_ENABLED: "0", GOOS: "linux" } },
    });
    expect(execStub).to.have.been.calledWith("go mod tidy", {
      cwd: ".",
      env: { ...process.env, ...{ CGO_ENABLED: "0", GOOS: "linux" } },
    });

    // Verify the compilation command was executed
    expect(execStub).to.have.been.calledWith(
      `go build -ldflags="-s -w" -o .bin/testFunc1 functions/func1/main.go`,
      {
        cwd: ".",
        env: {
          ...process.env,
          ...{ CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64" },
        },
      },
    );

    // Total calls should be 3: 2 beforeBuild commands + 1 compilation command
    expect(execStub.callCount).to.equal(3);
  });

  it("Should execute beforeBuild commands once for compileToInvoke", async () => {
    config.service
      .setCustom({
        go: {
          beforeBuild: ["echo 'before build command'", "go mod tidy"],
        },
      })
      .setFunctions({
        testFunc1: {
          name: "testFunc1",
          runtime: "provided.al2",
          handler: "functions/func1/main.go",
        },
      });

    const plugin = new Go(config, { function: "testFunc1" });
    plugin.exec = execStub;
    plugin.readFileSync = readFileSyncStub;
    plugin.zip = admZipStub;

    // when
    await plugin.compileToInvoke();

    // then
    // Verify beforeBuild commands were executed once
    expect(execStub).to.have.been.calledWith("echo 'before build command'", {
      cwd: ".",
      env: { ...process.env, ...{ CGO_ENABLED: "0", GOOS: "linux" } },
    });
    expect(execStub).to.have.been.calledWith("go mod tidy", {
      cwd: ".",
      env: { ...process.env, ...{ CGO_ENABLED: "0", GOOS: "linux" } },
    });

    // Verify compilation command was executed
    expect(execStub).to.have.been.calledWith(
      `go build -ldflags="-s -w" -o .bin/testFunc1 functions/func1/main.go`,
      {
        cwd: ".",
        env: {
          ...process.env,
          ...{ CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64" },
        },
      },
    );

    // Total calls should be 3: 2 beforeBuild commands + 1 compilation command
    expect(execStub.callCount).to.equal(3);
  });
  it("Does not leak arm64 GOARCH into x86_64 functions", async () => {
    config.service.setFunctions({
      armFunc: {
        name: "armFunc",
        runtime: "provided.al2023",
        architecture: "arm64",
        handler: "functions/arm",
      },
      x86Func: {
        name: "x86Func",
        runtime: "provided.al2023",
        handler: "functions/x86",
      },
    });

    const plugin = new Go(config);
    plugin.exec = execStub;
    plugin.readFileSync = readFileSyncStub;
    plugin.zip = admZipStub;

    await plugin.compileFunctions();

    const envOf = (bin) =>
      execStub.getCalls().find((c) => c.args[0].includes(bin)).args[1].env;
    expect(envOf(".bin/armFunc").GOARCH).to.equal("arm64");
    expect(envOf(".bin/x86Func").GOARCH).to.equal("amd64");
    expect(plugin.config.env.GOARCH).to.equal(undefined);
  });

  it("Produces byte-identical zips for identical binaries", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-go-"));
    const bin = path.join(dir, "fn");
    fs.writeFileSync(bin, "fake binary content");
    config.service.setFunctions({ fn: { name: "fn", handler: "fn" } });

    const plugin = new Go(config);
    plugin.zip = new AdmZip();

    plugin.packageBootstrap("fn", bin);
    const first = fs.readFileSync(bin + ".zip");
    await new Promise((r) => setTimeout(r, 2100)); // DOS mtime has 2s resolution
    plugin.zip = new AdmZip();
    plugin.packageBootstrap("fn", bin);
    const second = fs.readFileSync(bin + ".zip");

    fs.rmSync(dir, { recursive: true });
    expect(first.equals(second)).to.equal(true);
  }).timeout(5000);
});
