# statewalker-knowledge

Browser-based notebooks built on the statewalker stack. A notebook is a Markdown file or an
[Observable notebook-kit](https://github.com/observablehq/notebook-kit) HTML document. The
packages here build a tree of notebooks into a static site of executable pages, back SQL cells
with any `@statewalker/db-api` database, and serve the built site from one fetch handler.

This repository was previously named `statewalker-notebooks`.

## Packages

| Package | Description | npm |
| --- | --- | --- |
| [@statewalker/notebook-build](packages/notebook-build) | Builds a tree of notebooks on a `FilesApi` into a static site of executable pages, incrementally. | [npm](https://www.npmjs.com/package/@statewalker/notebook-build) |
| [@statewalker/notebook-db](packages/notebook-db) | Backs notebook-kit SQL cells with any `@statewalker/db-api` database: a live client, and a build-time precompute that writes the JSON files notebook-kit's cached client fetches. | [npm](https://www.npmjs.com/package/@statewalker/notebook-db) |
| [@statewalker/notebook-site](packages/notebook-site) | Serves a built notebook site as a `SiteHandler`: pages and attachments from files, modules from a module server (hosted mode) or from the export (static mode), plus the rebuild event stream. | [npm](https://www.npmjs.com/package/@statewalker/notebook-site) |
| [@statewalker/notebook-demo](apps/demo) | Private app, not published. Builds the notebooks in `apps/demo/notebooks` and serves them on a local port. | — |

## Relation to other statewalker repositories

| Dependency | Repository | Used by |
| --- | --- | --- |
| `@statewalker/webrun-files` (peer); `webrun-files-node`, `webrun-files-mem` (dev) | [webrun-files](https://github.com/statewalker/webrun-files) | all packages, demo |
| `@statewalker/webrun-builder`, `webrun-modules`, `webrun-site-builder` (peers); `webrun-site-host` (dev) | [webrun-sites](https://github.com/statewalker/webrun-sites) | notebook-build, notebook-site, demo |
| `@statewalker/webrun-http-events`; `webrun-http-browser` (dev) | [webrun-wire](https://github.com/statewalker/webrun-wire) | notebook-site |
| `@statewalker/db-api` (peer); `db-duckdb-browser` (dev) | [statewalker-db](https://github.com/statewalker/statewalker-db) | notebook-db; notebook-build browser tests |

## Requirements

- Node.js 24
- pnpm 10 through corepack: run `corepack enable` once. The exact version is pinned by
  `packageManager` in `package.json`.

## Development

```sh
pnpm install          # install the workspace
pnpm run build        # build every package (tsdown)
pnpm run test         # unit tests (vitest) in every package
pnpm run test:browser # browser tests: Playwright drives a real Chromium from Node
pnpm run typecheck    # tsc --noEmit in every package
pnpm run lint         # biome check --write . (lint and format, applying fixes)
pnpm run lint:check   # biome check . (no writes)
```

The browser tests need a Chromium for Playwright (`pnpm exec playwright install chromium`).
On a cold cache they download and transform npm packages, so the first run is slow.

To run the demo:

```sh
pnpm --filter @statewalker/notebook-demo start
```

## Releases

Releases are automated with [changesets](https://github.com/changesets/changesets). After CI
passes on `main`, a job adds a changeset for every package whose packed contents differ from
the version on npm, and opens a "chore: version packages" pull request. Merging that pull
request publishes to npm with provenance. To choose the bump or write the changelog entry
yourself, add a changeset to your pull request with `pnpm changeset`. Dependency updates come
from Renovate.

The shared CI and release setup is described in
[statewalker/.github](https://github.com/statewalker/.github#readme).

## License

[MIT](LICENSE)
