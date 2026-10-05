# @statewalker/notebook-site

## What it is

Composes one `SiteHandler` (a `Request` to `Response` function from
`@statewalker/webrun-site-builder`) that serves a site built by `@statewalker/notebook-build`:
pages and attachments from a `FilesApi`, npm module dependencies from a live module server, and
rebuild notifications as a Server-Sent Events stream from `@statewalker/webrun-http-events`.

## Why it exists

A built notebook site needs three things mounted side by side, with rules that are easy to get
wrong: module requests must not shadow pages, a static export must serve its modules from files,
paths must be percent-decoded, and nothing may throw out of the handler. This package owns that
composition and nothing else: no routing of its own, no build, no transport. The same handler
runs under Node, in a Worker, and behind a browser ServiceWorker.

## How to use

```sh
pnpm add @statewalker/notebook-site @statewalker/webrun-files @statewalker/webrun-site-builder
```

`@statewalker/webrun-files` and `@statewalker/webrun-site-builder` are peer dependencies. There
is one entry point, `@statewalker/notebook-site` (ESM). It exports `newNotebookSite` and
`primeModules`.

| option | meaning |
| --- | --- |
| `output` | The built site: pages, attachments, and in static mode the materialized dependency closure. |
| `moduleServer` | Serves `basePath/*` in hosted mode. Omit it for a static export: then nothing claims that prefix and the request falls through to `output`. |
| `basePath` | Where module dependencies are mounted (default `/_m/`). Must match the build's `basePath`. |
| `events` | A `PubSub` for rebuild notifications. Omit to serve without an event stream. |
| `eventsPath` | Where the event stream is mounted (default `/_events`). |
| `directoryIndex` | File served for a directory request (default `index.html`). `webrun-site-builder` has no default, and without one a directory request returns 404. |

## Examples

### Serve a built site

```ts
import { newNotebookSite } from "@statewalker/notebook-site";
import { newPubSub } from "@statewalker/webrun-http-events";

const events = newPubSub();

const handler = newNotebookSite({
  output,       // FilesApi: what notebook-build wrote
  moduleServer, // hosted mode only; omit for a static export
  events,       // omit for no event stream
  basePath: "/_m/",
  eventsPath: "/_events",
});

const response = await handler(new Request("http://localhost/reports/q3.html"));
```

### Warm the module cache before serving

```ts
import { primeModules } from "@statewalker/notebook-site";

// moduleServer: anything with prime(ref), e.g. newModuleServer from @statewalker/webrun-modules
const { primed, failed } = await primeModules(moduleServer, [
  { pkg: "d3", version: "7" },
  { pkg: "katex", version: "0.16", subpath: "dist/katex.mjs" },
]);
```

## Internals

### How a request is dispatched

```
Request ──► basePath/*    ──► moduleServer.fetch   (only when moduleServer is given)
        ──► eventsPath/*  ──► events.handler       (only when events is given)
        ──► /*            ──► output, percent-decoded, directoryIndex for directories
        any throw         ──► logged as "[notebook-site]", answered 500 "internal error"
```

Endpoints are matched before files, so both mounts must stay clear of notebook paths; that is
why the defaults start with an underscore.

- The mounts are prefixes of path segments, not of the string: `/_m/*` does not match
  `/_module-notes.html`, and `/_events/*` does not match `/_eventsource-guide.html`.
- A trailing slash is optional: `"/_m/"` and `"/_m"` mount the same place. The two defaults are
  spelled differently (`/_m/` with a slash, `/_events` without), so either spelling of either
  option works.
- The site root is refused. At `/` the endpoint would claim every page, `/index.html` included,
  so `newNotebookSite` throws:
  `newNotebookSite: basePath must not be the site root (got "/"); an endpoint mounted there claims every page, including /index.html`

### Paths are percent-decoded

A URL pathname is percent-encoded, and nothing below this package decodes it. Without decoding,
`/My%20Notebook.html` would 404 here while the same static export served by an ordinary HTTP
server works. Decoding is per segment. `%2f` is not turned into a path separator: a segment that
decodes to a dot-segment or contains a separator makes the request a 404 instead of reaching the
backend. A `%` that is not a valid escape is left as is, because a file name may contain one.

### Why nothing escapes the handler

A throw in any layer is logged and answered with a `500`, because a rejected handler inside a
ServiceWorker breaks every open page.

This does not cover a failure inside the response body. File responses stream from
`output.read()` lazily, so a backend that fails mid-read fails after the handler has returned:
the client gets a `200` with a truncated body, with no `500` and no log.

### Why priming is serial

The module server writes its `~deps` proxy files lazily, and that races concurrent browser
fetches: a cold first load can fail with a link error naming a proxy that is not written yet.
`primeModules` resolves the refs first. It runs one ref at a time, because concurrent priming
re-creates the contention it exists to avoid. It deduplicates refs, and a package that fails to
resolve lands in `failed` (with its error message) instead of stopping the rest.

### Hosting behind a ServiceWorker

`HostedSiteBuilder` from `@statewalker/webrun-site-host` runs the handler behind a ServiceWorker,
not inside one: the worker intercepts `fetch` and relays over a `MessagePort`, and the page-side
`SwHttpAdapter` (from `@statewalker/webrun-http-browser/sw`) calls the `SiteHandler`. The package is compiled without the DOM lib. That is a
compile-time guard, not proof that the handler never touches the DOM at run time.

### Dependencies

- `@statewalker/webrun-site-builder` (peer): `SiteBuilder`, which does the routing and file serving.
- `@statewalker/webrun-files` (peer): the `FilesApi` the site is served from.
- `@statewalker/webrun-http-events`: the `PubSub` type for the event stream.

## License

MIT
