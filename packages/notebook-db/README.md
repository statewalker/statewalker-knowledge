# @statewalker/notebook-db

## What it is

Backs notebook-kit SQL cells with any `@statewalker/db-api` `Db`: DuckDB, SQLite, or anything
else that implements the interface. It provides a live client for a page, a registry that opens
databases by name, and a build-time step that writes the JSON files notebook-kit's precomputed
SQL cells fetch.

## Why it exists

notebook-kit's `DatabaseClient.of(source, name)` accepts any object with a `sql`
tagged-template function as a database. This package supplies that object over a db-api `Db`,
so notebook-kit needs to know nothing about db-api and a notebook can use any db-api driver.
For precomputed cells notebook-kit runs no SQL at all; it fetches a cache file at a path derived
from hashes it does not export. `precomputeQueries` writes those files at the paths and in the
format notebook-kit reads.

## How to use

```sh
pnpm add @statewalker/notebook-db @statewalker/db-api @statewalker/webrun-files
```

`@statewalker/db-api` and `@statewalker/webrun-files` are peer dependencies. Bring a db-api
driver as well, for example `@statewalker/db-duckdb-node` or `@statewalker/db-duckdb-browser`.
There is one entry point, `@statewalker/notebook-db` (ESM). It runs in the browser and under
Node; which one depends on the driver.

| export | what it does |
| --- | --- |
| `newDbClient(db)` | Wraps a db-api `Db` as a `NotebookDbClient` (`sql`, `query`, `close`). |
| `newLiveDatabases({ open })` | A registry that opens databases by name on first use (`get`, `closeAll`). |
| `precomputeQueries(requests, databases, output)` | Runs `PrecomputeRequest`s at build time and writes notebook-kit's cache files into a `FilesApi`. Returns the paths written, one per request. |
| `cachePathFor(notebook, database, strings, params)` | The site path of the cache file for one query on one page. |

## Examples

### A client over a db-api database

```ts
import { newDbClient } from "@statewalker/notebook-db";
import { newNodeDuckDb } from "@statewalker/db-duckdb-node"; // or any other db-api driver

const db = await newNodeDuckDb();
const client = newDbClient(db);

// Tagged-template form, the shape a notebook SQL cell compiles to:
const rows = await client.sql`SELECT * FROM t WHERE id = ${id}`;

// Plain form, for callers that already have a SQL string:
const rows2 = await client.query("SELECT * FROM t WHERE id = ?", [id]);

await client.close();
```

### Live databases in a page

A live SQL cell (`database="var:db"`) compiles to ``DatabaseClient.of(db, "db").sql`…` ``, so
the notebook needs a `db` variable holding something with a `sql` tagged template. `get(name)`
resolves to such a client.

```ts
import { newLiveDatabases } from "@statewalker/notebook-db";
import { newBrowserDuckDb } from "@statewalker/db-duckdb-browser";

const databases = newLiveDatabases({ open: (name) => newBrowserDuckDb({ bundles }) });

// in the notebook's own js cell:
const db = await databases.get("warehouse");
```

### Precompute a query at build time

```ts
import { newDbClient, precomputeQueries } from "@statewalker/notebook-db";

const written = await precomputeQueries(
  [
    {
      notebook: "/reports/q3.html", // the page the cell lives on
      database: "warehouse",
      strings: ["SELECT * FROM sales WHERE year = ", ""],
      params: [2026],
    },
  ],
  new Map([["warehouse", newDbClient(db)]]),
  output, // FilesApi of the built site
);
// written[0] is "/reports/.observable/cache/<nameHash>-<hash>.json"
```

`@statewalker/notebook-build` does not create these requests; the caller assembles them.

## Internals

### Interpolations are bound, never concatenated

In the tagged template, the SQL text is `strings.join("?")` and the interpolated values are
passed as a separate `params` array to `Db.query(sql, params)`. A cell that interpolates
user-supplied data cannot inject SQL.

### Why a live database is opened once, and a failed open is retried

A database is opened on first `get` and reused; two callers racing the first `get` share one
`open`. A rejected open is not cached: OPFS can be unavailable and a wasm bundle can be blocked,
and both can be transient. The rejection is rewrapped with the name, because the driver's message
alone does not say which cell to fix:

```
cannot open database "warehouse": <driver message>
```

`closeAll()` closes every database opened so far and empties the registry, so a second teardown
does not close them twice and a later `get` opens a fresh database rather than returning a closed
one.

### BIGINT becomes number, or fails loudly

DuckDB returns `count(*)`, an integer `sum()` and any `BIGINT` column as a JavaScript `bigint`.
`newDbClient` converts those to `number` in both `sql` and `query`, and the precompute step does
the same before it serializes. This matches notebook-kit's own `DatabaseClient.revive`
(`row[name] = Number(value)`), so a live cell and a precomputed one show the same value. A string
would make `count(*)` render as `"3"` and `rows[0].c + 1` produce `"31"`.

A double holds every integer up to 2^53 exactly and none above it, so a value outside
`Number.MAX_SAFE_INTEGER` is an error naming the column and the value, never a rounded result:

```
cannot represent BIGINT column "id" as a JSON number: 9007199254740993 is outside
Number.MAX_SAFE_INTEGER (9007199254740991) and would become 9007199254740992.
Cast it in SQL (for example `CAST("id" AS VARCHAR)`) to keep the exact value.
```

Nested `LIST` and `STRUCT` values are converted too; `Date`, `Uint8Array` and other values with
their own prototype are left as they are. Only object rows are converted. A custom client that
returns tuple rows (`[[1n, 2n]]`) passes through, and `JSON.stringify` in `precomputeQueries`
then fails with `Do not know how to serialize a BigInt`.

### The cache file is `{rows, schema}`, and where it goes depends on the page

notebook-kit's `DatabaseClient.sql()` is `fetch(path).then(r => r.json()).then(revive)`, and
`revive` destructures `{rows, schema}` and iterates `schema`. A bare array would fail in the page
with `TypeError: schema is not iterable`, so `precomputeQueries` always writes the envelope.

The fetched path, `.observable/cache/<nameHash>-<hash>.json`, has no leading slash, so the
browser resolves it against the page's directory. That is why every `PrecomputeRequest` names
its page (`notebook`). A query run by pages in two directories is executed once and written
twice, once per directory. The hash covers `JSON.stringify([strings, ...params])`, so two queries
that differ only in a bound value, or in whether a literal is inline or bound, get different
files. `hash` and `nameHash` are not exported by notebook-kit, so this package reimplements them,
and its tests compare the result with notebook-kit's own `cachePath`.

A request whose `database` has no client in the map fails:

```
precomputeQueries: no database configured for "warehouse" (query: SELECT * FROM sales WHERE year = ?)
```

### `schema` says what to revive, not the SQL types

db-api reports no SQL types. `schema` only tells `revive` which values to rebuild after the JSON
round trip, and `revive` acts only on `"bigint"` and `"date"`. It is derived from the values:

- Every row is scanned, so a `Date` column whose first row is `NULL` is still found.
- A column that is `NULL` in every row is `"other"`.
- A column is `"date"` only if every non-null value is a `Date`. `revive` converts whole columns,
  so marking a mixed column would turn its non-dates into `Invalid Date`. A `Date` inside a mixed
  column therefore arrives as a string.
- `"bigint"` is never written: those values are already numbers.

### What this package does not do

It does not compose SQL, quote identifiers for a dialect, or flatten views and CTEs. For that use
notebook-kit's own `sql` tagged template, `SqlFragment`, `SqlView` and `sql.ident` from
`@observablehq/notebook-kit`, and hand the result to a client.

### Dependencies

- `@statewalker/db-api` (peer): the `Db` interface. No driver is required by the package itself.
- `@statewalker/webrun-files` (peer): path helpers and `FilesApi` for writing cache files.
- No runtime dependency on `@observablehq/notebook-kit`: the only use is a type, which is inlined
  in the built `.d.ts`.

## License

MIT
