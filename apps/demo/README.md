# @statewalker/notebook-demo

Private app, not published. It builds every notebook in `./notebooks` with
`@statewalker/notebook-build` and serves the result with `@statewalker/notebook-site` on a local
Node HTTP server. npm imports in the notebooks are resolved and transformed on demand by
`@statewalker/webrun-modules` and served from the same origin under `/_m/`, so the page makes no
third-party requests at run time.

## Run

From the repository root:

```sh
pnpm install
pnpm --filter @statewalker/notebook-demo start
```

`start` builds `notebook-build` and `notebook-site`, then runs `node serve.mjs`. Open
<http://localhost:8099/index.html>. Set `PORT` to use another port.

To rebuild when a notebook changes, run the server with `--watch` from this directory (after the
packages are built):

```sh
node serve.mjs --watch
```

The build writes the site to `.out/` and its caches (build state and downloaded modules) to
`.cache/`. The first run downloads and transforms the npm imports, so it is slow.
