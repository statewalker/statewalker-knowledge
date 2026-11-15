# @statewalker/notebook-site

## 0.2.0

### Minor Changes

- 95aa175: **Move to `@statewalker/webrun-files` 0.12 and the webrun-sites releases built on it.** The peer ranges move to these lines:
  - `@statewalker/webrun-files` ^0.12.0 (from ^0.10.0);
  - `@statewalker/webrun-builder` ^0.5.0 (from ^0.3.1 || ^0.4.0);
  - `@statewalker/webrun-modules` ^0.4.0 (from ^0.2.1 || ^0.3.0);
  - `@statewalker/webrun-site-builder` ^0.3.0 (from ^0.2.0).
  
  These are breaking lines. webrun-files 0.12 resolves `..` segments before any filter, guard or mount sees a path, and throws `Path climbs above the root` for a path above the root. Consumers must move to the same lines, so a single copy of the webrun-files core is installed. webrun-site-builder 0.3 uses the global `URLPattern`, which needs Node 24 or newer, or a browser.

## 0.1.2

### Patch Changes

- Release of the changes since the last published version:
  
  - files changed: README.md
