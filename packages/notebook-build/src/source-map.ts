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
 * the first stage's input, whose single source is named `source` and carries `content`.
 */
export function composeMaps(maps: StageMap[], source: string, content: string): SourceMapV3 {
  // `decodedMappings: false` (the default) writes `mappings` as a VLQ string.
  const composed = remapping(maps as Parameters<typeof remapping>[0], () => null);
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
/** The most cells the pairing of the edited lines between two unchanged ones may fill. */
const MAX_EDITED_LINES_DIFF = 250_000;
/** The most cells the character diff of one edited line may fill before it is overwritten whole. */
const MAX_CHAR_DIFF = 1_000_000;

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
  same: (x: T, y: T) => boolean = (x, y) => x === y,
): [number, number][] | undefined {
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > limit) return undefined;
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

/**
 * Whether two lines are one line edited: their common prefix and suffix cover at least half of
 * the shorter one, or the longer one contains the shorter whole (a `sql` cell's one line inside
 * its template). notebook-kit edits within a line (types erased, an import specifier or
 * `import.meta.url` replaced, a template opened or closed) and keeps most of it; the lines it
 * adds share little with any.
 */
function similar(x: string, y: string): boolean {
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let q = 0;
  while (q < x.length - p && q < y.length - p && x[x.length - 1 - q] === y[y.length - 1 - q]) q++;
  if (p + q > 0 && p + q >= Math.min(x.length, y.length) / 2) return true;
  const [shorter, longer] = x.length <= y.length ? [x.trim(), y] : [y.trim(), x];
  return shorter.length >= 3 && longer.includes(shorter);
}

/**
 * Pairs the lines of `input` with the lines of `output` they became: identical lines first (a
 * line diff), then, between those, lines `similar` enough to be one line edited.
 */
function pairLines(a: string[], b: string[]): [number, number][] | undefined {
  const exact = commonSubsequence(a, b, MAX_LINE_DIFF);
  if (!exact) return undefined;
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  for (const pair of [...exact, [a.length, b.length] as [number, number]]) {
    const [pi, pj] = pair;
    if (pi > i && pj > j) {
      const edited = commonSubsequence(
        a.slice(i, pi),
        b.slice(j, pj),
        MAX_EDITED_LINES_DIFF,
        similar,
      );
      if (!edited) return undefined;
      for (const [ei, ej] of edited) pairs.push([i + ei, j + ej]);
    }
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
  const pairs = pairLines(a, b);
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
    replayLine(s, start, from, to, head);
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
  let p = 0;
  while (p < from.length && p < text.length && from[p] === text[p]) p++;
  let q = 0;
  while (
    q < from.length - p &&
    q < text.length - p &&
    from[from.length - 1 - q] === text[text.length - 1 - q]
  ) {
    q++;
  }
  edit(s, start + p, end - q, text.slice(p, text.length - q), head);
}

/** Replays the edit of the line at `start` from `from` into `to`, character by character. */
function replayLine(s: MagicString, start: number, from: string, to: string, head: string[]) {
  if (from === to) return;
  const pairs = commonSubsequence(from, to, MAX_CHAR_DIFF);
  if (!pairs) return edit(s, start, start + from.length, to, head);
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [from.length, to.length] as [number, number]]) {
    if (pi > i || pj > j) edit(s, start + i, start + pi, to.slice(j, pj), head);
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

/** Each line of `output` that appears, in order, unchanged in `input` maps to it, column 0. */
function lineOnlyMap(input: string, output: string, source: string): StageMap {
  const lines = new Map<string, number[]>();
  input.split("\n").forEach((line, index) => {
    const list = lines.get(line);
    if (list) list.push(index);
    else lines.set(line, [index]);
  });
  let next = 0;
  let previous = 0;
  const mappings = output.split("\n").map((line) => {
    const index = lines.get(line)?.find((candidate) => candidate >= next);
    if (index === undefined) return "";
    const segment = `AA${vlq(index - previous)}A`;
    previous = index;
    next = index + 1;
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
