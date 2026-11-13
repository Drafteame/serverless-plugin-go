## v0.1.4 (2026-11-13)


- fix: default GOFLAGS=-trimpath -buildvcs=false and merge custom env with defaults (#14)

## v0.1.3 (2026-11-10)


- fix: per-function GOARCH and deterministic zip artifacts (#12)
- - Build env is now computed per function with an explicit GOARCH
  (arm64/amd64). Previously config.env was mutated, so once an arm64
  function compiled, every following x86_64 function was built as ARM,
  and x86_64 builds on Apple Silicon used the host arch.
- Zip entries use a fixed mtime so identical binaries yield
  byte-identical artifacts (stable hashes across builds).
- Bump mocha 10 -> 12 (mocha 10 fails to start on Node 26).

## v0.1.2 (2026-03-31)


- chore: add support for provided.al2023 runtime (#11)
- Co-authored-by: Ariel Santos <ariel.santos@draftea.com>

## v0.1.1 (2026-01-21)


- chore: implements trusted publisher and bump node 20 -> 24 (#9)

## v0.1.0 (2025-08-12)


- feat: build hooks (#8)
- * feat: add executable list of build hooks before build
- * fix: remove .idea folder

## v0.0.3 (2024-08-19)


- deps: resolve vulnerabilities (#7)

## v0.0.2 (2023-11-16)


- fix: concurrency overhead (#6)

## v0.0.1 (2023-10-26)


- chore: enable release pipeline (#5)
- chore: add debug logs (#4)
- chore: add start compilation logs (#3)
- fix: missing system env vars to execute comp[ilation command (#2)
- chore: first commit
