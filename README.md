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
        runtime: 'provided.al2'
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
  runtime: 'provided.al2'

# If you define architecture at function level, this will have preference instead the provider configuration

functions:
  test:
    architecture: 'arm64'
    handler: test/main.go
```

## Caveats

This implementation doesn't allow to add any other files to the lambda artifact apart from the binary. To address this problem you should
use Lambda Layers to allow your lambdas to hold external files.

## Credits

This repo is forked from [serverless-go-plugin][1] created by [mthenw][2] and modified to fix some issues and reach the new AWS standards
(go1.x provider deprecation).

[1]: https://github.com/mthenw/serverless-go-plugin
[2]: https://github.com/mthenw
