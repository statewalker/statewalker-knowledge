import { type Notebook, serialize } from "@observablehq/notebook-kit";
import { textHash } from "./hash.js";
import type { NotebookCellMode } from "./transpile.js";

/**
 * The DOM this build runs against. In a browser these are the natives; under
 * Node the caller injects jsdom. Nothing in this package reads a DOM global.
 */
export interface DomEnv {
  document: Document;
  parser: DOMParser;
}

/**
 * The `<script type>` of the modes notebook-kit has no type for. Its `serialize` writes such a
 * cell as `type="module"`, which `deserialize` reads back as `js`, so without these the cache
 * artifact would turn every jsx/tsx cell into a js cell that does not parse. Observable Desktop
 * reads them the same way, as js.
 */
export const EXTRA_MODE_TYPES: Partial<Record<NotebookCellMode, string>> = {
  jsx: "text/jsx",
  tsx: "text/tsx",
};

export function serializeNotebook(nb: Notebook, dom: DomEnv): string {
  const html = serialize(nb, { document: dom.document });
  const types = nb.cells.map((cell) => EXTRA_MODE_TYPES[cell.mode as NotebookCellMode]);
  // Byte-for-byte notebook-kit's output for a notebook without such a cell.
  if (types.every((type) => type === undefined)) return html;
  const notebook = dom.parser.parseFromString(html, "text/html").querySelector("notebook");
  if (!notebook) throw new Error("serializeNotebook: notebook-kit wrote no <notebook> element");
  for (const [i, script] of notebook.querySelectorAll("script").entries()) {
    const type = types[i];
    if (type !== undefined) script.setAttribute("type", type);
  }
  return `<!doctype html>\n${notebook.outerHTML}\n`;
}

/** Hex SHA-256 over the serialized notebook — one of the incremental build's gates. */
export function notebookHash(html: string): Promise<string> {
  return textHash(html);
}
