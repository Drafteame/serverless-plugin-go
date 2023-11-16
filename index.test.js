import sinon from "sinon";
import chai from "chai";
import sinonChai from "sinon-chai";

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
        env: { ...process.env, ...{ CGO_ENABLED: "0", GOOS: "linux" } },
      },
    );

    expect(config.service.functions.testFunc3.handler).to.equal(
      `.bin/testFunc3`,
    );

    expect(execStub).to.have.been.calledWith(
      `go build -ldflags="-s -w" -o .bin/testFunc3 functions/func3`,
      {
        cwd: ".",
        env: { ...process.env, ...{ CGO_ENABLED: "0", GOOS: "linux" } },
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
        env: { ...process.env, ...{ CGO_ENABLED: "0", GOOS: "linux" } },
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
        env: { ...process.env, ...{ CGO_ENABLED: "0", GOOS: "linux" } },
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
        env: { ...process.env, ...{ CGO_ENABLED: "0", GOOS: "linux" } },
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
        env: { ...process.env, ...{ CGO_ENABLED: "0", GOOS: "linux" } },
      },
    );

    expect(config.service.functions.testFunc2.handler).to.equal(
      `.bin/testFunc2`,
    );

    expect(execStub).to.have.been.calledWith(
      `go build -ldflags="-s -w" -o ../../.bin/testFunc2 main.go`,
      {
        cwd: "functions/func2",
        env: { ...process.env, ...{ CGO_ENABLED: "0", GOOS: "linux" } },
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
});
