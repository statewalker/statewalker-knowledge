import {
  type Cell,
  type CellMode,
  type Notebook,
  type TranspiledJavaScript,
  type TranspileOptions,
  transpile,
} from "@observablehq/notebook-kit";
import { transpileJsx } from "./jsx.js";
import type { PinMap } from "./resolve.js";
import { composeMaps, mapOfRewrite, type SourceMapV3 } from "./source-map.js";

export type { SourceMapV3 } from "./source-map.js";

/**
 * A cell's mode as this package reads it: notebook-kit's `CellMode` plus `jsx` and `tsx`, which
 * notebook-kit has no mode for. They travel in a notebook-kit `Notebook` under a cast, and
 * `serializeNotebook`/`parseNotebookHtml` keep them across the cache artifact.
 */
export type NotebookCellMode = CellMode | "jsx" | "tsx";

export interface CellDefinition {
  id: number;
  body: string;
  inputs: string[];
  outputs: string[];
  /**
   * The SINGULAR output name, which notebook-kit sets for every mode that is not js/ts/ojs
   * (`transpile.js`: `if (mode !== "ts" && mode !== "js" && mode !== "ojs") transpiled.output =
   * cell.output`). It is an ALTERNATIVE to `outputs`, not an addition: a cell that has one has
   * an empty other. notebook-kit's `define()` reads it to name the cell's variable, so a
   * renderer that drops it emits a definition no downstream cell can reference.
   */
  output?: string;
  autodisplay: boolean;
  mode: NotebookCellMode;
  /** Set when the cell did not compile; the page renders this in its place. */
  error?: string;
  /**
   * A version 3 source map from `body` to the cell's source (`cell.value`): its one source is
   * named by `TranspileNotebookOptions.sourceName` (default `cell-<id>`) and carries the source
   * as `sourcesContent`, so a caller can compose it with a map of its own (cell source to
   * Markdown, page script to cell). Set on every compiled cell; never on prose or a cell that
   * did not compile.
   */
  map?: SourceMapV3;
}

export interface TranspileNotebookOptions {
  /** The name of each cell map's one source. Default: `cell-<id>`. */
  sourceName?: (cell: Cell) => string;
}

/** What `transpileCell` returns: notebook-kit's result, plus a map when one was asked for. */
export type TranspiledCell = TranspiledJavaScript & { map?: SourceMapV3 };

/**
 * The modes this build compiles and the page can actually run. Exported because `render.ts`
 * must gate on the SAME set: two copies drifted apart is precisely how a widened transpile
 * yields cells that compile and are then rendered as prose.
 *
 * `jsx` and `tsx` are this package's own modes, compiled by `transpileJsx` (see `jsx.ts`).
 *
 * Of notebook-kit's other modes, why `sql` and nothing else, measured against the installed notebook-kit 2.6.4 rather than
 * inferred — `transpile()` returns a real body for EVERY mode below, so "notebook-kit supports
 * it" is not the test. The test is whether the body can run in a page this build produces:
 *
 *  * `sql` — body is `(await DatabaseClient.of(db, "db")).sql\`…\`` (a live database from a
 *    notebook variable) or `DatabaseClient("name", {id}).sql\`…\`` (a precomputed
 *    `.observable/cache/…json` fetch). `DatabaseClient` is defined directly in the runtime's
 *    `stdlib/index.js`, and both paths stay on this origin. IN.
 *  * `html`, `tex`, `dot` — the bodies need the `htl`, `tex` and `dot` builtins, and all three
 *    resolve through `stdlib/recommendedLibraries.js` to a literal
 *    `import("https://cdn.jsdelivr.net/npm/…")` (`tex.js` and `dot.js` import katex and
 *    @viz-js/viz from jsDelivr at module scope). A static export that reaches a CDN is not a
 *    static export; the browser suite asserts zero off-origin requests. OUT.
 *  * `node`, `python`, `r` — `Interpreter(mode, …).run(source)` does not execute anything: it
 *    is `FileAttachment(".observable/cache/<hash>.bin")`, a fetch of an artifact produced by a
 *    build-time data loader. This build has no interpreter stage, so every such cell would
 *    404. A cell that transpiles and then silently fails is worse than an inert one. OUT.
 *  * `sql.view` — body returns a `SqlView`, which is only useful with `displayMode: "table"`,
 *    and that display path is `import("./stdlib/inputs.js")`, whose first line is
 *    `export * from "https://cdn.jsdelivr.net/npm/@observablehq/inputs/+esm"`. Off-origin
 *    again, and without it the cell inspects an opaque query object. OUT.
 *  * `md` — has a body (`md\`…\``) and would work, but this build renders prose at BUILD time
 *    with markdown-it, into the document body, so it is readable with JavaScript disabled and
 *    costs the page nothing. Compiling it instead would be a regression, not a fix. OUT.
 *
 * For the same reason `displayMode` is not emitted anywhere in this package: notebook-kit's
 * own Vite plugin sets `displayMode: "table"` for `sql` cells, and that is the `inputs.js`
 * CDN path above. SQL results render through the default inspector here.
 */
export const CODE_MODES = new Set<NotebookCellMode>(["js", "ts", "jsx", "tsx", "ojs", "sql"]);

/**
 * Compiles one code cell: notebook-kit's `transpile` for its own modes, `transpileJsx` for
 * `jsx`/`tsx`. Shared with `collectSpecifiers`, so the imports a jsx cell's compiled body makes
 * (React's) are the ones `resolveNotebook` pins, and `copyAttachments` sees the attachments it
 * names. `ts` stays with notebook-kit, which erases
 * types without a transform (and refuses the non-erasable syntax: enums, namespaces,
 * parameter properties).
 */
export function transpileCell(
  cell: Cell,
  options: TranspileOptions,
  /** Name of the map's source; without it no map is built (`collectSpecifiers` needs none). */
  sourceName?: string,
): TranspiledCell {
  const mode = cell.mode as NotebookCellMode;
  if (mode === "jsx" || mode === "tsx") {
    // notebook-kit's `transpile(cell)` applies these two attributes; the jsx path must too.
    const t = transpileJsx(cell.value, mode, options, sourceName);
    if (cell.output) t.output = cell.output;
    if (cell.hidden) t.autodisplay = false;
    return t;
  }
  const t: TranspiledCell = transpile(cell, options);
  if (sourceName !== undefined) {
    // notebook-kit builds the body from edits of `cell.value` (the `sql` template rewrite
    // included) but returns no map of them: they are recovered from a diff.
    t.map = composeMaps([mapOfRewrite(cell.value, t.body, "kit-in")], sourceName, cell.value);
  }
  return t;
}

/**
 * Transpiles every code cell in `nb` against the module pin map produced by `resolveNotebook`.
 *
 * Synchronous by construction: every specifier was already resolved (awaited) in [Resolve].
 * `resolveImport` here is a pure `Map` lookup, matching notebook-kit's sync `resolveImport`
 * hook. An unpinned specifier — a URL import, a relative import, or a non-npm protocol like
 * `jsr:`/`observable:` — passes through unchanged (`pins.get(s) ?? s`) rather than becoming
 * "undefined" or a mangled value, which would fail at link time in the browser with a message
 * pointing nowhere near the cause.
 */
export function transpileNotebook(
  nb: Notebook,
  pins: PinMap,
  options: TranspileNotebookOptions = {},
): CellDefinition[] {
  const resolveImport = (specifier: string) => pins.get(specifier) ?? specifier;
  const sourceName = options.sourceName ?? ((cell: Cell) => `cell-${cell.id}`);

  return nb.cells.map((cell: Cell): CellDefinition => {
    if (!CODE_MODES.has(cell.mode as NotebookCellMode)) {
      // Prose cells, and every mode deliberately left out of CODE_MODES above, pass through
      // with empty inputs/outputs and no `output`, so the renderer lays them out in document
      // order as prose alongside code cells.
      return {
        id: cell.id,
        body: "",
        inputs: [],
        outputs: [],
        autodisplay: false,
        mode: cell.mode,
      };
    }
    try {
      const t = transpileCell(cell, { resolveImport }, sourceName(cell));
      return {
        id: cell.id,
        body: t.body,
        inputs: t.inputs ?? [],
        outputs: t.outputs ?? [],
        // Spread rather than `output: t.output`: `exactOptionalPropertyTypes` refuses an
        // explicit `undefined` for an optional field, and a cell with no singular output must
        // not carry the key at all — `renderDefineCall` decides on its presence.
        ...(t.output === undefined ? {} : { output: t.output }),
        autodisplay: t.autodisplay ?? false,
        mode: cell.mode,
        ...(t.map === undefined ? {} : { map: t.map }),
      };
    } catch (e) {
      // A cell that does not parse is the normal state while authoring — one broken cell must
      // not cost the author the other twenty. Record the error and keep going.
      return {
        id: cell.id,
        body: "",
        inputs: [],
        outputs: [],
        autodisplay: false,
        mode: cell.mode,
        error: String((e as Error)?.message ?? e),
      };
    }
  });
}
