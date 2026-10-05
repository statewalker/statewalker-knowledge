# @statewalker/notebook-demo

## What it is

A private app, not published. `serve.mjs` builds every notebook in `./notebooks` with
`@statewalker/notebook-build` and serves the result with `@statewalker/notebook-site` on a local
Node HTTP server. npm imports in the notebooks (`npm:@observablehq/plot`) are resolved and
transformed on demand by `@statewalker/webrun-modules` and served from the same origin under
`/_m/`, so the page makes no third-party requests at run time.

## The shape

```
apps/demo/
  serve.mjs            build once (or on change with --watch), then serve on $PORT (8099)
  notebooks/index.md   the demo notebook: reactive js cells, Observable Plot, a broken cell
  .out/                built site (generated, git-ignored)
  .cache/build/        build artifacts and incremental state (generated, git-ignored)
  .cache/modules/      downloaded and transformed npm modules (generated, git-ignored)
```

## How to run it

1. From the repository root: `pnpm install`.
2. `pnpm --filter @statewalker/notebook-demo start`. This builds `notebook-build` and
   `notebook-site`, then runs `node serve.mjs`.
3. Open <http://localhost:8099/index.html>. Set `PORT` to use another port.

To rebuild when a notebook changes, run `node serve.mjs --watch` from `apps/demo` after the
packages are built.

## Why it is the way it is

- **Hosted mode.** The demo passes `mode: "hosted"` and the module server to both the build and
  the site, so modules are served live from `/_m/` instead of being copied into `.out/`.
- **jsdom for the DOM.** The build reads no DOM global; under Node the demo creates a jsdom
  window and passes its `document` and `DOMParser`.
- **One deliberately broken cell.** `notebooks/index.md` contains a cell that does not compile,
  to show that the error is displayed in place and the other cells still run.

## What will surprise you

- **The first start is slow.** It downloads and transforms Observable Plot and its dependency
  graph into `.cache/modules/`. The console shows
  `building (first run downloads and transforms the npm imports)…`.
- **`notebooks/.notebook-build/` appears in the source tree.** The build engine keeps its scanner
  state in the `notebooks` store. It is git-ignored.
- **Build failures print `✗ undefined: undefined`.** `onFailed` receives an array of failures,
  but `serve.mjs` destructures it as a single `{ notebookPath, error }`. Look at the page itself
  for the error until this is fixed.

## Reference

| Command | What it does |
| --- | --- |
| `pnpm --filter @statewalker/notebook-demo start` | build the two packages, then `node serve.mjs` |
| `node serve.mjs` | build once and serve |
| `node serve.mjs --watch` | also rebuild when a file under `notebooks/` changes |

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8099` | HTTP port |
