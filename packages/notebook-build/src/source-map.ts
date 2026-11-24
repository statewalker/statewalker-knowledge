import remapping from "@jridgewell/remapping";
import MagicString from "magic-string";

/**
 * A version 3 source map (ECMA-426) as plain JSON: what `JSON.stringify` writes into a
 * `sourceMappingURL` and what `@jridgewell/trace-mapping` and `@jridgewell/remapping` read.
 */
export interface SourceMapV3 {
  version: 3;
  file?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
}

/** A map from one stage's output to its input, newest stage first in `composeMaps`. */
export type StageMap = Omit<SourceMapV3, "version"> & { version: number };

/**
 * `hires: "boundary"` maps the start of every word and punctuation run, which is the precision a
 * stack frame needs, at a fraction of `hires: true`'s size.
 */
const HIRES = "boundary" as const;

/** The map of a `MagicString`'s edits, its one source named `source`. */
export function mapOf(s: MagicString, source: string): StageMap {
  return s.generateMap({ source, hires: HIRES }) as StageMap;
}

/**
 * Composes stage maps, the one from the final text first, into one map from the final text to
 * the first stage's input, whose single source is named `source` and carries `content`; undefined
 * when they do not compose.
 */
export function composeMaps(
  maps: StageMap[],
  source: string,
  content: string,
): SourceMapV3 | undefined {
  let composed: ReturnType<typeof remapping>;
  try {
    // `decodedMappings: false` (the default) writes `mappings` as a VLQ string.
    composed = remapping(maps as Parameters<typeof remapping>[0], () => null);
  } catch {
    // A map is an aid: a cell that compiled keeps compiling without one.
    return undefined;
  }
  return {
    version: 3,
    sources: [source],
    sourcesContent: [content],
    names: composed.names,
    mappings: composed.mappings as string,
  };
}

/** The most cells (input lines times output lines) the line diff may fill before falling back. */
const MAX_LINE_DIFF = 4_000_000;
/**
 * The most cells the pairing of the edited lines between two unchanged ones may fill; a longer
 * run is paired greedily.
 */
const MAX_EDITED_LINES_DIFF = 250_000;
/** The most cells the character diff of one edited line may fill before it is overwritten whole. */
const MAX_CHAR_DIFF = 1_000_000;
/**
 * The most cells all the diffs of one rewrite may fill together, the line diff included; past it
 * the map is line-only. It bounds a cell of many long edited lines (data with type annotations).
 */
const MAX_REPLAY_CELLS = 24_000_000;

/** What is left of a rewrite's `MAX_REPLAY_CELLS`; a diff that would overdraw it throws. */
class Budget {
  constructor(public cells: number) {}
  spend(cells: number) {
    this.cells -= cells;
    if (this.cells < 0) throw new RangeError("the diff of this rewrite is over its budget");
  }
}

/**
 * A map from `output` to `input` for a rewrite that only deletes, inserts and replaces text and
 * never reorders it, as notebook-kit's `transpile` does (it builds its body from an edit list over
 * its input, but does not return a map of it).
 *
 * The edits are recovered from a diff (lines first, then the characters of each changed region)
 * and replayed onto a `MagicString` of `input`, which writes the map. The replay must rebuild
 * `output` exactly; when it does not, or the diff would be too large, the map is line-only: each
 * line of `output` found unchanged in `input` maps to that line, column 0. It never throws.
 */
export function mapOfRewrite(input: string, output: string, source: string): StageMap {
  try {
    const s = replayRewrite(input, output);
    if (s && s.toString() === output) return mapOf(s, source);
  } catch {
    // A replay magic-string refuses falls back like one that does not rebuild the output.
  }
  return lineOnlyMap(input, output, source);
}

/** The start offset of each line of `text` (lines split on `\n`, which belongs to neither). */
function lineStarts(lines: string[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  return starts;
}

/**
 * The common subsequence of `a` and `b` under `same`, as pairs of indexes, or undefined when its
 * table would exceed `limit` cells.
 */
function commonSubsequence<T>(
  a: ArrayLike<T>,
  b: ArrayLike<T>,
  limit: number,
  budget: Budget,
  same: (x: T, y: T) => boolean = (x, y) => x === y,
): [number, number][] | undefined {
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > limit) return undefined;
  budget.spend((n + 1) * (m + 1));
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  // The length of the common subsequence of `a[i...]` and `b[j...]`.
  const rest = (i: number, j: number) => table[i * width + j] ?? 0;
  const equal = (i: number, j: number) => same(a[i] as T, b[j] as T);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = equal(i, j)
        ? rest(i + 1, j + 1) + 1
        : Math.max(rest(i + 1, j), rest(i, j + 1));
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (equal(i, j) && rest(i, j) === rest(i + 1, j + 1) + 1) pairs.push([i++, j++]);
    else if (rest(i + 1, j) >= rest(i, j + 1)) i++;
    else j++;
  }
  return pairs;
}

/** The lengths of the common prefix of `x` and `y` and of their common suffix after it. */
function commonAffixes(x: string, y: string): [number, number] {
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let q = 0;
  while (q < x.length - p && q < y.length - p && x[x.length - 1 - q] === y[y.length - 1 - q]) q++;
  return [p, q];
}

/** The fewest non-space characters two lines must share to be taken for one line edited. */
const MIN_SHARED = 4;

/**
 * Whether two lines are one line edited: their common prefix and suffix hold at least
 * `MIN_SHARED` non-space characters and cover at least half of the shorter line, or the longer
 * one contains the shorter whole (a `sql` cell's one line inside its template). notebook-kit
 * edits within a line (types erased, an import specifier or `import.meta.url` replaced, a
 * template opened or closed) and keeps most of it; the lines it adds share little with any, and
 * what they share is short: its import header's closing `});` ends as many a call does.
 */
function similar(x: string, y: string): boolean {
  const [p, q] = commonAffixes(x, y);
  if (p + q >= MIN_SHARED && p + q >= Math.min(x.length, y.length) / 2) {
    let shared = 0;
    for (let k = 0; k < p && shared < MIN_SHARED; k++) if (x.charCodeAt(k) > 32) shared++;
    for (let k = x.length - q; k < x.length && shared < MIN_SHARED; k++) {
      if (x.charCodeAt(k) > 32) shared++;
    }
    if (shared >= MIN_SHARED) return true;
  }
  const [shorter, longer] = x.length <= y.length ? [x.trim(), y] : [y.trim(), x];
  return shorter.length >= MIN_SHARED && longer.includes(shorter);
}

/** How far `greedyPairs` looks ahead on either side for a line's counterpart. */
const LOOKAHEAD = 8;

/**
 * Pairs `a` with `b` in order where `same` holds, looking at most `LOOKAHEAD` lines ahead on
 * either side: linear, for runs of lines too long to diff (a long cell whose every line is
 * annotated). notebook-kit inserts lines only around the body and at the hoisted imports, so the
 * lines it edits follow each other on both sides.
 */
function greedyPairs(
  a: string[],
  b: string[],
  same: (x: string, y: string) => boolean,
): [number, number][] {
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    let found: [number, number] | undefined;
    for (let d = 0; d <= LOOKAHEAD && !found; d++) {
      for (let k = 0; k <= d && !found; k++) {
        // Every (i + k, j + d - k): the nearest pairs first.
        const x = a[i + k];
        const y = b[j + d - k];
        if (x !== undefined && y !== undefined && same(x, y)) found = [i + k, j + d - k];
      }
    }
    if (!found) {
      i++;
      j++;
      continue;
    }
    pairs.push(found);
    i = found[0] + 1;
    j = found[1] + 1;
  }
  return pairs;
}

/**
 * Pairs the lines of `input` with the lines of `output` they became: identical lines first (a
 * line diff), then, between those, lines `similar` enough to be one line edited. In each run
 * between identical lines the edited lines at its two ends are paired one to one while they are
 * similar (an annotated cell's lines, which notebook-kit edits in place), and only what is left
 * in the middle (its import header against the import declarations) goes through a diff.
 */
function pairLines(a: string[], b: string[], budget: Budget): [number, number][] | undefined {
  const exact = commonSubsequence(a, b, MAX_LINE_DIFF, budget);
  if (!exact) return undefined;
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  for (const pair of [...exact, [a.length, b.length] as [number, number]]) {
    const [pi, pj] = pair;
    // The longest run of similar lines along a diagonal, from (x, y) by `step`, within the gap.
    const run = (x: number, y: number, step: 1 | -1, lo: [number, number]) => {
      let n = 0;
      while (
        x + n * step >= lo[0] &&
        y + n * step >= lo[1] &&
        x + n * step < pi &&
        y + n * step < pj &&
        similar(a[x + n * step] ?? "", b[y + n * step] ?? "")
      ) {
        n++;
      }
      return n;
    };
    // At each end, the run that skips the fewest output lines notebook-kit added there (the
    // `return {…};` and `}` after the body, `async (…) => {` before it).
    const longest = (x: number, y: number, step: 1 | -1, lo: [number, number]) => {
      let best: [number, number] = [0, 0];
      for (let skip = 0; skip <= LOOKAHEAD; skip++) {
        const n = run(x, y + skip * step, step, lo);
        if (n > best[0]) best = [n, skip];
        if (n > 0) break;
      }
      return best;
    };
    const [front, frontSkip] = longest(i, j, 1, [i, j]);
    for (let k = 0; k < front; k++) pairs.push([i + k, j + frontSkip + k]);
    const after: [number, number] = [i + front, j + frontSkip + front];
    const [back, backSkip] = longest(pi - 1, pj - 1, -1, after);
    const gapEnd: [number, number] = [pi - back, pj - backSkip - back];
    if (gapEnd[0] > after[0] && gapEnd[1] > after[1]) {
      const gapA = a.slice(after[0], gapEnd[0]);
      const gapB = b.slice(after[1], gapEnd[1]);
      const edited =
        commonSubsequence(gapA, gapB, MAX_EDITED_LINES_DIFF, budget, similar) ??
        greedyPairs(gapA, gapB, similar);
      for (const [ei, ej] of edited) pairs.push([after[0] + ei, after[1] + ej]);
    }
    for (let k = back; k > 0; k--) pairs.push([gapEnd[0] + back - k, gapEnd[1] + back - k]);

    if (pi < a.length) pairs.push(pair);
    i = pi + 1;
    j = pj + 1;
  }
  return pairs;
}

/**
 * Replays the rewrite of `input` into `output` on a `MagicString` of `input`: each paired line
 * is edited character by character, and the text between paired lines (lines deleted and
 * inserted, with their newlines) is replaced as a whole, keeping its common prefix and suffix.
 */
function replayRewrite(input: string, output: string): MagicString | undefined {
  const a = input.split("\n");
  const b = output.split("\n");
  const budget = new Budget(MAX_REPLAY_CELLS);
  const pairs = pairLines(a, b, budget);
  if (!pairs) return undefined;
  const aStart = lineStarts(a);
  const bStart = lineStarts(b);
  const s = new MagicString(input);
  const head: string[] = [];
  // The end of the previous paired line, in input and output (the start, before the first).
  let inputAt = 0;
  let outputAt = 0;
  for (const [i, j] of pairs) {
    const from = a[i] ?? "";
    const to = b[j] ?? "";
    const start = aStart[i] ?? 0;
    const outputStart = bStart[j] ?? 0;
    replayGap(s, input, inputAt, start, output.slice(outputAt, outputStart), head);
    replayLine(s, start, from, to, head, budget);
    inputAt = start + from.length;
    outputAt = outputStart + to.length;
  }
  replayGap(s, input, inputAt, input.length, output.slice(outputAt), head);
  if (head.length) s.prepend(head.join(""));
  return s;
}

/** Replaces `input[start, end)` with `text`, keeping their common prefix and suffix. */
function replayGap(
  s: MagicString,
  input: string,
  start: number,
  end: number,
  text: string,
  head: string[],
) {
  const from = input.slice(start, end);
  if (from === text) return;
  const [p, q] = commonAffixes(from, text);
  edit(s, start + p, end - q, text.slice(p, text.length - q), head);
}

/**
 * Replays the edit of the line at `start` from `from` into `to`: their common prefix and suffix
 * are kept, and what lies between is diffed character by character (overwritten whole when that
 * diff would be too large), so a long line with one annotation erased costs its length, not its
 * length squared.
 */
function replayLine(
  s: MagicString,
  start: number,
  from: string,
  to: string,
  head: string[],
  budget: Budget,
) {
  if (from === to) return;
  const [p, q] = commonAffixes(from, to);
  const oldMiddle = from.slice(p, from.length - q);
  const newMiddle = to.slice(p, to.length - q);
  const at = start + p;
  const pairs = commonSubsequence(oldMiddle, newMiddle, MAX_CHAR_DIFF, budget);
  if (!pairs) return edit(s, at, at + oldMiddle.length, newMiddle, head);
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [oldMiddle.length, newMiddle.length] as [number, number]]) {
    if (pi > i || pj > j) edit(s, at + i, at + pi, newMiddle.slice(j, pj), head);
    i = pi + 1;
    j = pj + 1;
  }
}

/**
 * Replaces `[start, end)` of the original with `text`: an overwrite, removal or insertion. An
 * insertion goes to `appendLeft`, which a later edit of the text after it leaves in place, so
 * edits are made in order of position; insertions at 0, which have no text before them, are
 * collected and prepended once the replay is done (`prepend` puts each before the last).
 */
function edit(s: MagicString, start: number, end: number, text: string, head: string[]) {
  if (start < end) {
    if (text) s.overwrite(start, end, text);
    else s.remove(start, end);
  } else if (text) {
    if (start > 0) s.appendLeft(start, text);
    else head.push(text);
  }
}

/**
 * Each line of `output` paired in order with the line of `input` it is, or is an edit of, maps
 * to that line at column 0.
 */
function lineOnlyMap(input: string, output: string, source: string): StageMap {
  const a = input.split("\n");
  const b = output.split("\n");
  const lineOf = new Map<number, number>();
  for (const [i, j] of greedyPairs(a, b, (x, y) => x === y || similar(x, y))) lineOf.set(j, i);
  let previous = 0;
  const mappings = b.map((_, j) => {
    const index = lineOf.get(j);
    if (index === undefined) return "";
    const segment = `AA${vlq(index - previous)}A`;
    previous = index;
    return segment;
  });
  return {
    version: 3,
    sources: [source],
    sourcesContent: [input],
    names: [],
    mappings: mappings.join(";"),
  };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** One signed base64 VLQ, as source map mappings encode numbers. */
function vlq(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    out += BASE64[digit];
  } while (rest > 0);
  return out;
}
