---
"@statewalker/notebook-site": minor
---

Depends on `@statewalker/webrun-http-events` ^0.2.1 (was ^0.1.0), another breaking line. Pass
`events` a `PubSub` from webrun-http-events 0.2: its `FetchHandler` may now answer synchronously
(`Response | Promise<Response>`), so `await` it rather than calling `.then` on it. Topics that need
percent-encoding (`my topic`, `a/b`, `what?`) now reach their subscribers through the `/_events/*`
mount. The browser test now runs against `@statewalker/webrun-site-host` 0.5 and
`@statewalker/webrun-http-browser` 0.16's `sw-worker.js` (development dependencies only).
