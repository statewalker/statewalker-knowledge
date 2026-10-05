# @statewalker/notebook-build

## What it is

Turns a tree of notebooks on a `FilesApi` (`@statewalker/webrun-files`) into a static site of
executable pages, incrementally. A notebook is a Markdown file (fenced `js`/`ts`/`ojs`/`sql`
blocks become cells, everything else is prose) or an
[Observable notebook-kit](https://github.com/observablehq/notebook-kit) HTML document. Each one
becomes an `.html` page that imports notebook-kit's runtime and runs its own cell graph in the
browser.

## Why it exists

notebook-kit ships a Vite plugin for building notebooks. This package builds them over
`FilesApi` instead, with no bundler and no DOM global, so a build can run under Node or in a
browser against any `FilesApi` backend. npm imports are resolved through a module
server and served from the site's own origin, so a built page makes no third-party requests.
The build is incremental: a run re-derives only the notebooks whose inputs changed.

## How to use

```sh
pnpm add @statewalker/notebook-build @statewalker/webrun-builder @statewalker/webrun-files @statewalker/webrun-modules
```

`@statewalker/webrun-builder`, `@statewalker/webrun-files` and `@statewalker/webrun-modules` are
peer dependencies. There is one entry point, `@statewalker/notebook-build` (ESM).

Create a build with `newNotebookBuild(options)` and call `build()`. `build()` runs to
convergence and returns; call it again to pick up changes.

| option | meaning |
| --- | --- |
| `notebooks` | Source tree. Scanned recursively; `.md` and `.html` are notebooks, everything else is data. |
| `output` | Where pages, attachments and (in static mode) the dependency closure are written. |
| `cache` | Where the serialized-notebook artifacts and the incremental state live. |
| `moduleServer` | Resolves and serves npm packages (`ModuleServerLike`: `resolve`, `listResources`, `listPackageFiles`, `fetch`). `newModuleServer` from `@statewalker/webrun-modules` provides it. |
| `dom` | A `document` and a `DOMParser`. Nothing in this package reads a DOM global. |
| `mode` | `"static"` (default) materializes the whole dependency closure into `output`; `"hosted"` leaves it to a live module server. |
| `basePath` | URL prefix the module server serves packages under (default `/_m/`). |
| `stylesUrl` | Stylesheet the pages link. Unset, the pages carry no styles at all. |
| `onRebuilt` | Called once per converged build with every output path that changed: page, attachments and closure. |
| `onFailed` | Called once per converged build with `NotebookFailure[]` (`{ notebookPath, error }`). One bad notebook never stops the others. |
| `logger` | A `Logger` from `@statewalker/webrun-builder`. Defaults to a no-op logger. |

## Examples

### Build a directory of notebooks under Node

```ts
import { newNotebookBuild } from "@statewalker/notebook-build";
import { NodeFilesApi } from "@statewalker/webrun-files-node";
import { newModuleServer } from "@statewalker/webrun-modules";
import { JSDOM } from "jsdom";

const notebooks = new NodeFilesApi({ rootDir: "./notebooks" });
const output = new NodeFilesApi({ rootDir: "./.out" });
const cache = new NodeFilesApi({ rootDir: "./.cache/build" });
const moduleServer = newModuleServer({
  cache: new NodeFilesApi({ rootDir: "./.cache/modules" }),
  basePath: "/_m/",
});

const { window } = new JSDOM("<!doctype html>");

const build = newNotebookBuild({
  notebooks,
  output,
  cache,
  moduleServer,
  dom: { document: window.document, parser: new window.DOMParser() },
  mode: "static",
  stylesUrl: "/_m/@observablehq/notebook-kit@2.6.6/dist/src/styles/index.css",
  onRebuilt: (changed) => console.log("changed", changed),
  onFailed: (failures) => failures.forEach((f) => console.error(f.notebookPath, f.error)),
});

await build.build();
```

In a browser, pass `{ document, parser: new DOMParser() }` and any browser `FilesApi`.

### Use the stages directly

The stages `newNotebookBuild` is made of are exported too:

```ts
import {
  parseMarkdown,
  renderPage,
  resolveNotebook,
  transpileNotebook,
} from "@statewalker/notebook-build";

const nb = parseMarkdown("# Hello\n\n```js\nconst x = 1 + 1\n```\n");
const pins = await resolveNotebook(nb, { moduleServer }, "/hello.md"); // npm specifier -> URL
const cells = transpileNotebook(nb, pins);
const html = renderPage(nb, cells, { runtimeUrl }); // runtimeUrl: notebook-kit's runtime module URL
```

| export | what it does |
| --- | --- |
| `parseMarkdown(source)` | Markdown source to a notebook-kit `Notebook`. |
| `parseNotebookHtml(html, dom)` | notebook-kit HTML document to a `Notebook`. |
| `serializeNotebook(nb, dom)`, `notebookHash(html)` | Serialize a `Notebook` to notebook-kit HTML; hash that HTML. |
| `collectSpecifiers(nb)`, `isNpmSpecifier(s)`, `toModuleRef(s)` | Find a notebook's import specifiers and turn `npm:` ones into module refs. |
| `resolveNotebook(nb, { moduleServer }, notebookPath)` | Resolve every npm import to a pinned URL (`PinMap`). Throws `ResolveError`. |
| `transpileNotebook(nb, pins)` | Compile the code cells to `CellDefinition[]`. |
| `renderPage(nb, cells, { runtimeUrl, stylesUrl })` | Render the page HTML. |
| `copyAttachments(nb, source, output, notebookPath)` | Copy the `FileAttachment`s a notebook references; returns `CopiedAttachment[]` (path and hash). |
| `materializeDeps(pins, server, output, basePath)`, `ASSET_EXTENSIONS` | Write the static dependency closure into `output`. |

## Internals

### What a notebook publishes

For `/reports/q3.md`:

- `/reports/q3.html`: the page, with one root element per cell and one `define()` per code cell.
- every `FileAttachment("…")` it references, copied to the same relative path, including one
  inside a `sql` cell's `${…}` interpolation, which notebook-kit compiles as JavaScript like any
  other cell's.
- in static mode, the dependency closure under `basePath`: every JS-reachable module, plus two
  kinds of file the JS graph never imports. Without them the export looks complete and fails at
  the first wasm instantiation:
  - the `.wasm`, `.css` and font files a package ships (`ASSET_EXTENSIONS`);
  - the classic worker scripts it ships (`*.worker.js`, not their `.map` files). These are
    fetched with `?raw` so the module server's CJS-to-ESM transform does not wrap them: DuckDB's
    worker bundles are UMD, and a classic worker cannot parse the `import`/`export` a wrapped
    one would contain. The file is written at its plain `.worker.js` path, so the site serves it
    with a JavaScript content type, as the spec requires for a classic worker script.

Deleting a notebook prunes exactly what it published, minus anything another notebook still
claims.

### Why the three stores must be three directories

The engine scans `notebooks`, the serialized artifacts go to `cache`, and pages go to `output`.
If two of them were the same directory, the scanner would find the files the build just wrote
and feed them back in as sources, and the site would publish the build's own cache. The
constructor rejects one instance passed twice; the first `build()` also writes a hidden probe
file into `cache` and `output` and looks for it in the others, because two `FilesApi` instances
can point at one directory. Overlap deeper down (an `output` rooted inside the notebooks tree)
is not detected.

### What makes a page rebuild

A notebook is re-derived unless everything its published page depended on is unchanged: the
serialized notebook (compared by content hash, so a touched file with identical bytes is
reused), the build configuration (`mode`, `basePath`, `stylesUrl`), the resolved pin map, the
content of every attachment, and the presence of every output. A notebook with no recorded
successful build is retried on the next run without its source being touched.

### Cell modes

`js`, `ts`, `ojs` and `sql` cells are compiled and run in the page. The other modes render as
inert prose, because their compiled body cannot run in a page this build produces:

| mode | why it stays prose |
| --- | --- |
| `html`, `tex`, `dot`, `sql.view` | They need the `htl`, `tex`, `dot` and `Inputs` builtins, which notebook-kit loads from `cdn.jsdelivr.net`. A static export must not depend on a CDN. |
| `node`, `python`, `r` | Data-loader cells: `Interpreter(…).run(src)` fetches `.observable/cache/<hash>.bin`, produced by a build-time interpreter stage this build does not have. Every such cell would 404. |
| `md` | Rendered at build time with markdown-it into the document body, so prose is readable with JavaScript off. |

### SQL cells

A SQL cell's `database` and `output` attributes decide how it runs, and only a notebook-kit HTML
source can carry them; a Markdown fence has no attribute syntax.

- `database="var:db"` (the default) is **live**: the cell compiles to
  ``DatabaseClient.of(db, "db").sql`…` `` and queries the notebook's own `db` variable. Any
  object with a `sql` tagged-template function works, for example a `@statewalker/notebook-db`
  client over a `@statewalker/db-api` `Db`.
- `database="warehouse"` is **precomputed**: notebook-kit's client runs no SQL. It fetches
  `.observable/cache/<nameHash>-<hash>.json` relative to the page, so a notebook at
  `/reports/q3.html` reads `/reports/.observable/cache/…`. `precomputeQueries` from
  `@statewalker/notebook-db` writes those files.
- `output="revenue"` exposes the cell's rows to the rest of the notebook. Two cells declaring one
  name fail the build, as two `const x` cells do.

A Markdown ` ```sql ` fence has neither attribute, so it is a live, anonymous cell: it queries
`db`, displays its result, and nothing downstream can name its rows. The notebook must define
`db` in another cell.

SQL results render through notebook-kit's default inspector, not `displayMode: "table"`: the
table display imports `@observablehq/inputs` from jsDelivr.

### What this package does not do with databases

`NotebookBuildOptions` has no database option, and nothing here turns a parsed notebook into
`PrecomputeRequest`s. A `database="warehouse"` cell's cache file is therefore never written by
this build; the caller must assemble the requests and run `precomputeQueries` itself. Only live
SQL cells work from a build alone.

### Failures you will see

Each failure is reported through `onFailed` for its notebook; the other notebooks still build.

- `` newNotebookBuild: `notebooks`, `output` and `cache` must be distinct FilesApi instances `` (thrown by the constructor)
- `` newNotebookBuild: `cache` and `notebooks` are the same directory — they must be distinct FilesApi instances over distinct roots ``
- `/a.md: /a.md and /a.html all publish to /a.html — rename all but one`
- `/a.md: cannot resolve import "npm:…": …` (`ResolveError`)
- `/a.md: attachment "…" resolves outside the notebook's own directory (/)`
- `/a.md: cannot find attachment "data.csv" (expected at /data.csv)`
- `/a.md: "x" is declared by two cells (cell 1 and cell 3)`

### Dependencies

- `@observablehq/notebook-kit`: parsing, serialization, transpilation and the page runtime.
- `markdown-it`: renders prose cells at build time.
- `@statewalker/webrun-builder` (peer): the incremental build engine.
- `@statewalker/webrun-files` (peer): the storage interface.
- `@statewalker/webrun-modules` (peer): the module server the build expects.

## License

MIT
