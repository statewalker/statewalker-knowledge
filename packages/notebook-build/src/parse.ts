import { type CellMode, deserialize, type Notebook, toNotebook } from "@observablehq/notebook-kit";
import { type DomEnv, EXTRA_MODE_TYPES } from "./serialize.js";

const EXTRA_MODES = new Map(Object.entries(EXTRA_MODE_TYPES).map(([mode, type]) => [type, mode]));

export function parseNotebookHtml(html: string, dom: DomEnv): Notebook {
  // deserialize already returns a fully-normalized Notebook (it calls toNotebook
  // internally). The outer toNotebook here is a harmless idempotent second pass,
  // kept for explicitness so downstream stages never have to trust that an
  // upstream default was actually applied.
  const nb = deserialize(html, { parser: dom.parser });
  // notebook-kit reads a `text/jsx`/`text/tsx` script as `js`; put back the mode
  // `serializeNotebook` wrote. `deserialize` makes one cell per `notebook script`, in order.
  const scripts = dom.parser.parseFromString(html, "text/html").querySelectorAll("notebook script");
  const cells = nb.cells.map((cell, i) => {
    const mode = EXTRA_MODES.get(scripts[i]?.getAttribute("type") ?? "");
    return mode === undefined ? cell : { ...cell, mode: mode as CellMode };
  });
  return toNotebook({ ...nb, cells });
}
