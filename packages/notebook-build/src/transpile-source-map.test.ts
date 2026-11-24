import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { type CellSpec, toNotebook } from "@observablehq/notebook-kit";
import { describe, expect, it } from "vitest";
import { type CellDefinition, transpileNotebook } from "./transpile.js";

const REACT_PINS = new Map([
  ["react", "/_m/react@19/index.js"],
  ["react/jsx-runtime", "/_m/react@19/jsx-runtime.js"],
  ["react-dom/client", "/_m/react-dom@19/client.js"],
]);

/** One cell of the given mode, compiled; fails the test if it did not compile. */
function compile(mode: string, value: string, pins = new Map<string, string>()): CellDefinition {
  const cell = transpileNotebook(
    toNotebook({ cells: [{ id: 7, mode, value }] as unknown as CellSpec[] }),
    pins,
  )[0]!;
  expect(cell.error).toBeUndefined();
  expect(cell.map).toBeDefined();
  return cell;
}

/**
 * The 1-based line and 0-based column of the `nth` occurrence of `needle` in `text`. A `|` in the
 * needle marks the token within it (`missing.|value`); without one the needle starts at it.
 */
function positionOf(text: string, needle: string, nth = 1): { line: number; column: number } {
  const marker = Math.max(needle.indexOf("|"), 0);
  const token = needle.replace("|", "");
  let at = -1;
  for (let i = 0; i < nth; i++) {
    at = text.indexOf(token, at + 1);
    if (at < 0) throw new Error(`${JSON.stringify(token)} not found ${nth} times in:\n${text}`);
  }
  at += marker;
  const before = text.slice(0, at);
  const line = before.split("\n").length;
  return { line, column: at - (before.lastIndexOf("\n") + 1) };
}

/** Where the map sends the `nth` occurrence of `token` in the cell's body. */
function traceToken(cell: CellDefinition, token: string, nth = 1) {
  const { line, column } = positionOf(cell.body, token, nth);
  const pos = originalPositionFor(new TraceMap(cell.map!), { line, column });
  return { source: pos.source, line: pos.line, column: pos.column };
}

describe("transpileNotebook, source maps", () => {
  it("maps a js cell's tokens back to their line and column in the cell source", () => {
    const value = [
      `import * as Plot from "npm:@observablehq/plot";`,
      "const data = [1, 2, 3];",
      "const chart = Plot.dot(data);",
    ].join("\n");
    const cell = compile("js", value, new Map([["npm:@observablehq/plot", "/_m/plot@1/index.js"]]));
    expect(cell.map!.version).toBe(3);
    expect(cell.map!.sources).toEqual(["cell-7"]);
    expect(cell.map!.sourcesContent).toEqual([value]);
    expect(traceToken(cell, "data =")).toEqual({
      source: "cell-7",
      ...positionOf(value, "data ="),
    });
    expect(traceToken(cell, "Plot.dot")).toEqual({
      source: "cell-7",
      ...positionOf(value, "Plot.dot"),
    });
    expect(traceToken(cell, "chart")).toEqual({ source: "cell-7", ...positionOf(value, "chart") });
  });

  it("maps a ts cell's tokens across the type annotations notebook-kit erases", () => {
    const value = [
      "type Row = { x: number; label: string };",
      "function scale(row: Row, factor: number): number {",
      "  return row.x * factor;",
      "}",
      'const rows: Row[] = [{ x: 1, label: "a" }];',
      "const total: number = rows.map((r: Row) => scale(r, 2)).length;",
    ].join("\n");
    const cell = compile("ts", value);
    expect(cell.body).not.toContain(": number");
    // [needle in the body, needle in the source]: each starts at the same token.
    for (const [inBody, inSource] of [
      ["factor) {", "factor: number)"],
      ["factor;", "factor;"],
      ["row.x", "row.x"],
      ["rows =", "rows: Row[]"],
      ["total =", "total: number"],
      ["scale(r", "scale(r"],
      ["r) => scale", "r: Row)"],
    ] as const) {
      expect(traceToken(cell, inBody), inBody).toEqual({
        source: "cell-7",
        ...positionOf(value, inSource),
      });
    }
  });

  it("maps a tsx cell's tokens through sucrase, notebook-kit and the React wrapper", () => {
    const value = [
      `import {format} from "npm:d3-format";`,
      "type Props = { n: number };",
      "function Badge({ n }: Props) {",
      '  return <b className="badge">{format(".2f")(n)}</b>;',
      "}",
      "const boom = (p: Props) => (p as any).missing.value;",
      "display(<Badge n={2} />);",
    ].join("\n");
    const cell = compile("tsx", value, REACT_PINS);
    expect(cell.body).toContain("__jsxRuntime");
    for (const [inBody, inSource] of [
      ["function Badge", "function Badge"],
      ['".2f"', '".2f"'],
      ["boom =", "boom ="],
      ["p) =>", "p: Props"],
      [".missing", ".missing"],
      ["missing.|value", "missing.|value"],
      ["display(_jsx", "display(<"],
      ["Badge, {", "Badge n"],
    ] as const) {
      expect(traceToken(cell, inBody), inBody).toEqual({
        source: "cell-7",
        ...positionOf(value, inSource),
      });
    }
  });

  it("keeps lines right after a keyed JSX element, where sucrase's map loses columns", () => {
    // sucrase moves `key` to the end of the `_jsx` call and its map then keeps one segment per
    // line, at column 0, to the end of the output (sucrase 3.35.1): lines stay right.
    const value = [
      "const items = [1, 2].map((r) => <li key={r}>{r}</li>);",
      "const later = items.length;",
      "const last = later + 1;",
    ].join("\n");
    const cell = compile("jsx", value, REACT_PINS);
    for (const [inBody, line] of [
      ["later =", 2],
      ["later + 1", 3],
      ["last =", 3],
    ] as const) {
      const traced = traceToken(cell, inBody);
      expect(traced.source, inBody).toBe("cell-7");
      expect(traced.line, inBody).toBe(line);
    }
  });

  it("maps an expression cell, which notebook-kit wraps in `return (`", () => {
    const value = "\nMath.max(\n  width,\n  height * 2\n)\n";
    const cell = compile("js", value);
    expect(cell.autodisplay).toBe(true);
    for (const needle of ["Math.max", "  |width,", "height *", "2\n"]) {
      expect(traceToken(cell, needle), needle).toEqual({
        source: "cell-7",
        ...positionOf(value, needle),
      });
    }
  });

  it("maps a jsx expression cell", () => {
    // sucrase maps the first token inside a JSX `{…}` to the brace itself; the ones after it to
    // their own columns.
    const value = "<b title={label.toUpperCase()}>hi</b>";
    const cell = compile("jsx", value, REACT_PINS);
    expect(cell.autodisplay).toBe(true);
    expect(traceToken(cell, "label.|toUpperCase")).toEqual({
      source: "cell-7",
      ...positionOf(value, "label.|toUpperCase"),
    });
  });

  it("maps a sql cell's query", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a sql cell's interpolation.
    const value = "SELECT n\nFROM numbers\nWHERE n > ${min}";
    const cell = compile("sql", value);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a sql cell's interpolation.
    for (const needle of ["FROM", "WHERE", "${|min}"]) {
      expect(traceToken(cell, needle), needle).toEqual({
        source: "cell-7",
        ...positionOf(value, needle),
      });
    }
  });

  it("falls back to a line-only map for a cell too long to diff, and still compiles it", () => {
    // Over 2,000 lines, the diff that recovers notebook-kit's edits would fill more than 4 M
    // cells, so each kept line maps to its line at column 0 instead.
    const lines = ["let total = 0;", "{"];
    for (let i = 0; i < 2100; i++) lines.push(`  total += ${i};`);
    lines.push("}");
    const value = lines.join("\n");
    const cell = compile("js", value);
    for (const needle of [
      "total = 0",
      "  |total += 0;",
      "  |total += 1234;",
      "  |total += 2099;",
    ]) {
      const { line } = positionOf(value, needle);
      expect(traceToken(cell, needle), needle).toEqual({ source: "cell-7", line, column: 0 });
    }
  });

  it("maps a one-line sql cell's query inside the template notebook-kit wraps it in", () => {
    const value = "SELECT name FROM people";
    const cell = compile("sql", value);
    for (const needle of ["SELECT", "name", "FROM", "people"]) {
      expect(traceToken(cell, needle), needle).toEqual({
        source: "cell-7",
        ...positionOf(value, needle),
      });
    }
  });

  it("maps an ojs cell", () => {
    const value = "viewof amount = Inputs.range([0, 10], { step: 1 })";
    const cell = compile("ojs", value);
    for (const needle of ["Inputs.range", "range(", "step"]) {
      expect(traceToken(cell, needle), needle).toEqual({
        source: "cell-7",
        ...positionOf(value, needle),
      });
    }
  });

  it("names the map's source as the caller asks", () => {
    const [cell] = transpileNotebook(
      toNotebook({ cells: [{ id: 3, mode: "js", value: "const a = 1;" }] as CellSpec[] }),
      new Map(),
      { sourceName: (c) => `notes.md#cell-${c.id}` },
    );
    expect(cell!.map!.sources).toEqual(["notes.md#cell-3"]);
    expect(traceToken(cell!, "a =").source).toBe("notes.md#cell-3");
  });

  it("gives prose and cells that do not compile no map", () => {
    const cells = transpileNotebook(
      toNotebook({
        cells: [
          { id: 1, mode: "md", value: "# Title" },
          { id: 2, mode: "js", value: "const broken = ;" },
        ] as CellSpec[],
      }),
      new Map(),
    );
    expect(cells.map((c) => c.map)).toEqual([undefined, undefined]);
  });

  // notebook-kit's import header ends with a `});` line, which shares only `);` with an edited
  // line after it; pairing the two left the edited line unmapped.
  for (const [name, mode, value, needles] of [
    [
      "a js cell whose import precedes an edited line",
      "js",
      'import {select} from "npm:d3";\nconst zz = select(await import("npm:d3"));\nzz.boom();',
      [
        ["const zz", "const zz"],
        ["zz = select", "zz = select"],
        ["select(await", "select(await"],
        ["select(|await", "select(|await"],
        ["zz.|boom", "zz.|boom"],
      ],
    ],
    [
      "a ts cell whose import precedes an annotated line",
      "ts",
      'import {select} from "npm:d3";\nconst zz: any = select("body");',
      [
        ["const zz", "const zz"],
        ["zz = select", "zz: any"],
        ['select("body', 'select("body'],
      ],
    ],
    [
      "a ts cell whose type import precedes an annotated line",
      "ts",
      'import type {Selection} from "npm:d3";\nimport {select} from "npm:d3";\nconst zz: Selection = select("body");',
      [
        ["const zz", "const zz"],
        ["zz = select", "zz: Selection"],
        ['select("body', 'select("body'],
      ],
    ],
  ] as const) {
    it(`maps ${name} to its own line`, () => {
      const cell = compile(mode, value, new Map([["npm:d3", "/_m/d3@7/index.js"]]));
      for (const [inBody, inSource] of needles) {
        expect(traceToken(cell, inBody), inBody).toEqual({
          source: "cell-7",
          ...positionOf(value, inSource),
        });
      }
    });
  }

  it("maps a data-heavy ts cell in time linear in its size", () => {
    // Each line is edited (its annotation erased) and long: a character diff of whole lines
    // costs their length squared, 14 s for 900 such lines before.
    const row = (i: number) =>
      `const a${i}: number[] = [${Array.from({ length: 220 }, (_, j) => (j * 7919 + i) % 1000).join(",")}];`;
    const value = Array.from({ length: 400 }, (_, i) => row(i)).join("\n");
    const started = performance.now();
    const cell = compile("ts", value);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(traceToken(cell, "a399 =")).toEqual({ source: "cell-7", ...positionOf(value, "a399:") });
  });
});
