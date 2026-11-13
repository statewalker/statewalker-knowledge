---
"@statewalker/notebook-build": minor
---

Runs on `@statewalker/webrun-builder` 0.3 (peer range `^0.3.0`): the pipeline is two builders — `Notebook` (one task per source) and `Page` (render; its `dispose` prunes a removed notebook) — and the engine's state lives under `notebooks/.notebook-build/engine`. Behaviour is unchanged: the same freshness gates, failure reporting and pruning.
