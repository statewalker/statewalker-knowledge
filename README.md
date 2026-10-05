# statewalker-knowledge

## What it is

A pnpm workspace of packages that turn notebooks into web pages that run in the browser. A
notebook is a Markdown file or an [Observable notebook-kit](https://github.com/observablehq/notebook-kit)
HTML document. `@statewalker/notebook-build` builds a tree of notebooks into a site of
executable pages, `@statewalker/notebook-db` backs SQL cells with any `@statewalker/db-api`
database, and `@statewalker/notebook-site` serves the built site from one fetch handler. All
storage goes through `FilesApi` (`@statewalker/webrun-files`), so the same code runs under
Node, in a Worker and behind a ServiceWorker.

## The shape

```
packages/
  notebook-build/   notebooks (FilesApi) -> pages + attachments + module closure (FilesApi)
  notebook-db/      db-api Db -> notebook-kit SQL source; build-time SQL cache files
  notebook-site/    built site (FilesApi) -> one SiteHandler (Request -> Response)
apps/
  demo/             private: builds ./notebooks and serves them on localhost:8099
```

How the pieces connect:

```
  notebooks/*.md, *.html ──► newNotebookBuild ──► output/   (pages, attachments,
          (FilesApi)              │   ▲                       static: /_m/ closure)
                                  │   └── moduleServer (@statewalker/webrun-modules)
                                  ▼
                               cache/  (serialized notebooks, incremental state)

  Request ──► newNotebookSite ──► /_m/*       moduleServer   (hosted mode only)
                              ├─► /_events/* PubSub (SSE)    (optional)
                              └─► /*         output/
```

| Package | What it does | Published |
| --- | --- | --- |
| [@statewalker/notebook-build](packages/notebook-build) | Builds a tree of notebooks on a `FilesApi` into a static site of executable pages, incrementally. | [npm](https://www.npmjs.com/package/@statewalker/notebook-build) |
| [@statewalker/notebook-db](packages/notebook-db) | Backs notebook-kit SQL cells with any `@statewalker/db-api` database: a live client, and a build-time precompute that writes the JSON files notebook-kit's cached client fetches. | [npm](https://www.npmjs.com/package/@statewalker/notebook-db) |
| [@statewalker/notebook-site](packages/notebook-site) | Serves a built notebook site as a `SiteHandler`: pages and attachments from files, modules from a module server (hosted mode) or from the export (static mode), plus the rebuild event stream. | [npm](https://www.npmjs.com/package/@statewalker/notebook-site) |
| [@statewalker/notebook-demo](apps/demo) | Builds the notebooks in `apps/demo/notebooks` and serves them. | private |

## How to run it

Requirements: Node.js 24 and pnpm 10 through corepack. The pnpm version is pinned by
`packageManager` in `package.json`.

1. `corepack enable`
2. `pnpm install`
3. `pnpm run build` (each package builds with tsdown into `dist/`)
4. `pnpm run test`
5. Optional, browser tests: `pnpm --filter @statewalker/notebook-build exec playwright install chromium`,
   then `pnpm run test:browser`.
6. Optional, the demo: `pnpm --filter @statewalker/notebook-demo start`, then open
   <http://localhost:8099/index.html>.

## Why it is the way it is

- **Every store is a `FilesApi`.** Sources, output, build cache and module cache are all
  `FilesApi` instances, so the build and the server run anywhere a `FilesApi` backend exists:
  the Node filesystem, memory, OPFS.
- **Nothing reads a DOM global.** `notebook-build` takes a `document` and a `DOMParser` as
  options (jsdom under Node, the natives in a browser), and `notebook-site` is compiled without
  the DOM lib, so it can run in a Worker.
- **npm imports are served from the same origin.** In hosted mode a live module server
  resolves and transforms npm packages on demand under `/_m/`; in static mode the build writes
  the whole dependency closure into the output. In both cases a page makes no third-party
  requests at run time.
- **Browser tests are a separate script.** `pnpm run test` never launches a browser. The browser
  tests drive a real Chromium through Playwright from Node, because they have to execute built
  pages, a real DuckDB-WASM and a real ServiceWorker.
- **Integrations are peer dependencies.** `@statewalker/webrun-files`, `webrun-builder`,
  `webrun-modules`, `webrun-site-builder` and `@statewalker/db-api` are peers, so an
  application and these packages share one copy of each interface.

## What will surprise you

- **The first browser test run or demo start is slow.** On a cold cache the module server
  downloads and transforms the npm dependency graph of the notebooks (Observable Plot, DuckDB).
  The browser tests allow up to 15 minutes for their setup hook for this reason.
- **`pnpm exec playwright` at the root is the wrong Playwright.** Playwright is a dependency
  of the packages, not of the root; run it through `pnpm --filter <package> exec` so the
  browser matches the version the tests import.
- **The build keeps its scanner state inside the notebooks tree.** The build engine stores its
  state in the `notebooks` `FilesApi` under `.notebook-build/`. The demo ignores
  `notebooks/.notebook-build/` in git; do the same in your own source tree.
- **There is no `format` script.** `pnpm run lint` runs `biome check --write .`, which lints and
  formats in one pass; `pnpm run lint:check` checks both without writing.

## Reference

### Commands

| Command | What it does |
| --- | --- |
| `pnpm run build` | `tsdown` in every package |
| `pnpm run test` | builds each package, then `vitest run` |
| `pnpm run test:browser` | Playwright browser tests in every package |
| `pnpm run typecheck` | `tsc --noEmit` for sources and browser tests |
| `pnpm run lint` | `biome check --write .` |
| `pnpm run lint:check` | `biome check .` |
| `pnpm changeset` | add a changeset (bump type and changelog text) to a pull request |

### Releases

Packages are published to npm from CI with [changesets](https://github.com/changesets/changesets).
A pull request may carry a changeset made with `pnpm changeset`; otherwise one is generated for
each package whose packed contents differ from the version on npm. Each package ships `dist/`
(JavaScript and `.d.ts`) and its TypeScript sources in `src/`; `exports` point at `dist/`.

### License

MIT, see [LICENSE](LICENSE).
