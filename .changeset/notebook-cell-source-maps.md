---
"@statewalker/notebook-build": minor
---

`transpileNotebook` returns a v3 source map (`map`) beside each compiled cell's `body`, from the body to the cell's source, for every code mode (`js`, `ts`, `jsx`, `tsx`, `ojs`, `sql`). Its source is named `cell-<id>`, or by the new `sourceName` option. notebook-kit's edits are recovered from a diff and checked; when that fails, or the cell is too long, the map falls back to line-only.
