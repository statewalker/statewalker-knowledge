# @statewalker/notebook-build

## 0.2.1

### Patch Changes

- 8499313: Peer range `@statewalker/webrun-builder` widened to `^0.3.1 || ^0.4.0` (0.4 only adds `BuildEngine.steps()`), so installs with webrun-builder 0.4 no longer warn about an unmet peer.

## 0.2.0

### Minor Changes

- 86abad3: Runs on `@statewalker/webrun-builder` 0.3.1 (peer range `^0.3.1`): the pipeline is two builders — `Notebook` (one task per source) and `Page` (render; its `dispose` prunes a removed notebook) — and the engine's state lives under `notebooks/.notebook-build/engine`. The freshness gates, failure reporting and pruning are the same. Changes: `build()` calls made while one is in progress wait for it (they used to run concurrently); the first build prunes the outputs of notebooks removed while no engine state recorded them (e.g. right after this upgrade) and deletes the old `notebooks/.notebook-build/state`; a task failing with an unexpected error (I/O) is reported through `onFailed` too.

## 0.1.1

### Patch Changes

- Release of the changes since the last published version:
  
  - files changed: README.md
