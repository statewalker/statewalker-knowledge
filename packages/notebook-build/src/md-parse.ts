import {
  type CellMode,
  type CellSpec,
  type Notebook,
  toNotebook,
} from "@observablehq/notebook-kit";
import MarkdownIt from "markdown-it";
import type { NotebookCellMode } from "./transpile.js";

/**
 * Fence languages that map onto a cell mode. Anything else stays prose. `jsx` and `tsx` are this
 * package's own modes (notebook-kit has none): see `NotebookCellMode`.
 */
const FENCE_MODES: Record<string, NotebookCellMode> = {
  js: "js",
  javascript: "js",
  ts: "ts",
  typescript: "ts",
  jsx: "jsx",
  tsx: "tsx",
  ojs: "ojs",
  sql: "sql",
  html: "html",
  tex: "tex",
  latex: "tex",
  dot: "dot",
  python: "python",
  py: "python",
  r: "r",
};

const md = new MarkdownIt({ html: true });

/** Split `---\n...\n---\n` front matter off the head of a document. */
function splitFrontMatter(source: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { meta: {}, body: source };
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { meta, body: source.slice(match[0].length) };
}

export function parseMarkdown(source: string): Notebook {
  const { meta, body } = splitFrontMatter(source);
  const tokens = md.parse(body, {});
  const cells: CellSpec[] = [];
  // 1-based, not 0-based. notebook-kit's ids are positive integers throughout, and its
  // `deserialize` treats anything that is not one as ABSENT: a cell numbered 0 is renumbered to
  // `++maxCellId` = 1, which then collides with the cell we numbered 1, which is renumbered to 2,
  // and so on down the document. Numbering from 0 therefore made the serialized artifact
  // non-idempotent — `deserialize(serialize(nb)).cells[i].id !== nb.cells[i].id` — so the two
  // artifacts of one build disagreed (`cache/….nb.html` carried 0..3 while `output/….html`
  // carried cell-1..cell-4), and opening the artifact in Observable Desktop and saving it back
  // rewrote every id, every byte, and with them the incremental build's content hash.
  let id = 1;
  let prose: string[] = [];
  let title: string | undefined = meta.title;

  const flushProse = () => {
    const text = prose.join("\n").trim();
    prose = [];
    if (text) cells.push({ id: id++, mode: "md", value: text });
  };

  for (const [i, token] of tokens.entries()) {
    if (token.type === "fence") {
      const mode = FENCE_MODES[(token.info ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? ""];
      if (mode) {
        flushProse();
        // notebook-kit's `CellMode` has no jsx/tsx; the cell carries it anyway (`toNotebook`
        // copies the mode through), and every stage of this package reads it as
        // `NotebookCellMode`.
        cells.push({ id: id++, mode: mode as CellMode, value: token.content.replace(/\n$/, "") });
        continue;
      }
    }
    if (title === undefined && token.type === "heading_open" && token.tag === "h1") {
      title = tokens[i + 1]?.content?.trim();
    }
    // Only top-level block tokens (level === 0) carry a non-overlapping `map` range for the
    // whole document: a `heading_open`/`paragraph_open` and its nested `inline` child both
    // carry a `map` that covers the same source lines, so counting every token with a `map`
    // double-counts that range. Restricting to level 0 keeps each source line counted once.
    if (token.level === 0 && token.map) {
      prose.push(body.split(/\r?\n/).slice(token.map[0], token.map[1]).join("\n"));
    }
  }
  flushProse();

  return toNotebook({
    cells,
    ...(title === undefined ? {} : { title }),
    ...(meta.theme === undefined ? {} : { theme: meta.theme as Notebook["theme"] }),
  });
}
