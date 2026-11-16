# ⚡️Serverless Framework Go Plugin

[![npm](https://img.shields.io/npm/v/serverless-plugin-go)](https://www.npmjs.com/package/serverless-plugin-go)

`serverless-plugin-go` is a Serverless Framework plugin that compiles Go functions on the fly. You don't need to do it manually before `serverless deploy`. Once the plugin is installed it will happen automatically.

## Features

- Concurrent compilation happens across all CPU cores.
- Support for both `serverless deploy` and `serverless deploy function` commands.
- Support for `serverless invoke local` command.
- Additional command `serverless go build`.

## Install

1. Install the plugin

    ```bash
    npm i --save-dev serverless-plugin-go
    ```

1. Add it to your `serverless.yaml`

    ```yaml
    plugins:
      - 'serverless-plugin-go'
    ```

1. Replace every Go function's `handler` with `*.go` file path or a package path. E.g.

    ```yaml
    functions:
      example:
        runtime: 'provided.al2023' # or provided.al2
        handler: 'functions/example/main.go' # or just functions/example
    ```

## Configuration

Default values:

```yaml
custom:
  go:
    # folder where go.mod file lives, if set `handler` property should be set relatively to that folder
    baseDir: '.'

    # Final target destination of the binary outputs
    binDir: '.bin'

    # Compile command that should be used to build binaries
    cmd: 'go build -ldflags="-s -w"'

    # If enabled, builds function every directory (useful for monorepo where go.mod is managed by each function
    monorepo: false

    # Number of concurrent process used to compile functions, you can fine tune this number to your needs.
    # Alternatively you can use the env var `SP_GO_CONCURRENCY` to override this configuration
    concurrency: 5

    # Environment variables used to compile binaries
    env:
      GOOS: 'linux' # Default compile OS
      CGO_ENABLED: '0' # By default CGO is disabled
      GOFLAGS: '-trimpath -buildvcs=false' # Reproducible builds by default
      # Variables you define are merged with these defaults; redefining one (e.g. GOFLAGS) replaces
      # its whole value. These values also override any same-named variable from the shell.
      
    # Bash commands to execute before compilation
    # These commands will be executed once before all compilations
    beforeBuild: []
```

### How does it work?

The plugin compiles every Go function defined in `serverless.yaml` into `.bin` directory. After that it internally changes `handler` so
that the Serverless Framework will deploy the compiled file not the source file.

For every matched function it also overrides `package` parameter to the next config:

```yaml
individually: true
artifact: <path to the generated zip with go binary>
```

### How to run Golang Lambda on ARM?

Change architecture field from `provider` or function configuration to `arm64`:

```yaml
provider:
  architecture: 'arm64'
  runtime: 'provided.al2023' # or provided.al2

# If you define architecture at function level, this will have preference instead the provider configuration

functions:
  test:
    architecture: 'arm64'
    handler: test/main.go
```

### How to execute commands before compilation?

You can define bash commands to be executed before any compilation action using the `beforeBuild` configuration:

```yaml
custom:
  go:
    beforeBuild:
      - 'go generate ./...'
      - 'go mod tidy'
```

These commands will be executed once before all compilations, not for each function individually. This applies whether you're using `serverless deploy`, `serverless deploy function`, or `serverless invoke local`.

## Tracing (opt-in)

Set `SP_GO_TRACE=1` to export an OpenTelemetry trace of the build. It is off by default and adds no dependencies.

```bash
SP_GO_TRACE=1 \
TRACEPARENT=00-<trace-id>-<parent-span-id>-01 \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
serverless package
```

- `TRACEPARENT` (W3C trace context) is optional: when valid, plugin spans continue that trace (e.g. your CI pipeline trace); otherwise a new trace is started.
- Spans are sent once at the end as OTLP/HTTP JSON to `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, or `OTEL_EXPORTER_OTLP_ENDPOINT` + `/v1/traces` (default `http://localhost:4318`). `OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_SERVICE_NAME` are honored. Export failures never fail the build.
- Spans: `go.build` (functions, concurrency, Go version), `go.before_build` (command count only), `go.compile` (function, GOOS/GOARCH/GOFLAGS, runtime, binary size and sha256) and `go.package` (zip size and sha256).
- Resource attributes: plugin version, Node version, host arch/OS, and, when present, `GITHUB_REPOSITORY`, `GITHUB_SHA`, `GITHUB_REF_NAME`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT` and `GITHUB_JOB` (as `git.*` / `ci.*`).
- Nothing else from the environment is exported, and build commands (`cmd`, `beforeBuild`) are never included.

## Caveats

This implementation doesn't allow to add any other files to the lambda artifact apart from the binary. To address this problem you should
use Lambda Layers to allow your lambdas to hold external files.

## Credits

This repo is forked from [serverless-go-plugin][1] created by [mthenw][2] and modified to fix some issues and reach the new AWS standards
(go1.x provider deprecation).

[1]: https://github.com/mthenw/serverless-go-plugin
[2]: https://github.com/mthenw
