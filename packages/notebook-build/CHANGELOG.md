# @statewalker/notebook-build

## 0.5.0

### Minor Changes

- 0746089: `transpileNotebook` returns a v3 source map (`map`) beside each compiled cell's `body`, from the body to the cell's source, for every code mode (`js`, `ts`, `jsx`, `tsx`, `ojs`, `sql`). Its source is named `cell-<id>`, or by the new `sourceName` option. notebook-kit's edits are recovered from a diff and checked; when that fails, or the cell is too long, the map falls back to line-only.

## 0.4.0

### Minor Changes

- 3095ebc: `jsx` and `tsx` fences are code cells. They are compiled with sucrase (types erased, JSX to `react/jsx-runtime`), React is resolved through the module server like any npm import, and a cell whose value is a React element, or a React element passed to `display`, is rendered with `react-dom/client`. The cache artifact keeps the two modes as `text/jsx`/`text/tsx` scripts.

## 0.3.0

### Minor Changes

- 95aa175: **Move to `@statewalker/webrun-files` 0.12 and the webrun-sites releases built on it.** The peer ranges move to these lines:
  - `@statewalker/webrun-files` ^0.12.0 (from ^0.10.0);
  - `@statewalker/webrun-builder` ^0.5.0 (from ^0.3.1 || ^0.4.0);
  - `@statewalker/webrun-modules` ^0.4.0 (from ^0.2.1 || ^0.3.0);
  - `@statewalker/webrun-site-builder` ^0.3.0 (from ^0.2.0).
  
  These are breaking lines. webrun-files 0.12 resolves `..` segments before any filter, guard or mount sees a path, and throws `Path climbs above the root` for a path above the root. Consumers must move to the same lines, so a single copy of the webrun-files core is installed. webrun-site-builder 0.3 uses the global `URLPattern`, which needs Node 24 or newer, or a browser.

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
