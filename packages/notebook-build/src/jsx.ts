import {
  type TranspiledJavaScript,
  type TranspileOptions,
  transpile,
} from "@observablehq/notebook-kit";
import MagicString from "magic-string";
import { transform } from "sucrase";
import { composeMaps, mapOf, mapOfRewrite, type SourceMapV3, type StageMap } from "./source-map.js";

const JSX_RUNTIME = "react/jsx-runtime";
const REACT = "react";
const REACT_DOM_CLIENT = "react-dom/client";

/** The module each of sucrase's auto-imports comes from, as the wrapper below names it. */
const NAMESPACES: Record<string, string> = {
  [JSX_RUNTIME]: "__jsxRuntime",
  [REACT]: "__react",
};

/**
 * Compiles a `jsx` or `tsx` cell so it runs on notebook-kit's runtime, which has no mode for
 * either.
 *
 * Sucrase does the source transform, because this package also runs in browsers and
 * `transpileNotebook` is synchronous: sucrase is plain JavaScript with a synchronous
 * `transform` (esbuild-wasm needs an asynchronous wasm start-up, and esbuild itself is a native
 * binary), it erases TypeScript types (enums included) and compiles JSX to the automatic
 * runtime, as Observable Framework does with esbuild (`jsx: "automatic"`, React as the import
 * source). `@statewalker/webrun-modules` already uses it for the same job.
 *
 * Sucrase prefixes its output with `import {jsx as _jsx} from "react/jsx-runtime";` (and
 * `import {createElement as _createElement} from "react";` for a key after a spread). In a
 * notebook cell an import declaration DECLARES its names, so two jsx cells would both declare
 * `_jsx` and the build would refuse the notebook. The prefix is therefore cut off, which leaves
 * the helpers free references (inputs, to notebook-kit), and the compiled body is wrapped in a
 * function that imports the three React modules through `options.resolveImport` (so `resolveNotebook`
 * pins them like any npm import) and passes the helpers in their place.
 *
 * The wrapper also displays React: a cell whose value is a React element (an expression cell),
 * or a value handed to `display`, is rendered with `react-dom/client`'s `createRoot` into a
 * `<div>` that notebook-kit then displays, as Framework's `displayJsx` does.
 *
 * Given `sourceName`, the result also carries `map`, a v3 source map from the body to `source`
 * composed from each stage's: sucrase's own (`sourceMapOptions`), magic-string's for the line
 * shift, the prefix cut and the wrapper, and notebook-kit's edits recovered by `mapOfRewrite`.
 */
export function transpileJsx(
  source: string,
  mode: "jsx" | "tsx",
  options: TranspileOptions = {},
  sourceName?: string,
): TranspiledJavaScript & { map?: SourceMapV3 } {
  // The source goes in one line down, so sucrase's import prefix has line 1 to itself and is cut
  // off exactly: matching import declarations at the head of the output instead would also
  // take the author's own first `import` with it.
  const shifted = new MagicString(source).prepend("\n");
  let code: string;
  let sucraseMap: StageMap | undefined;
  try {
    ({ code, sourceMap: sucraseMap } = transform(shifted.toString(), {
      transforms: mode === "tsx" ? ["jsx", "typescript"] : ["jsx"],
      jsxRuntime: "automatic",
      jsxImportSource: REACT,
      production: true,
      // Leave modern syntax alone: notebook-kit parses it, and the page runs in a browser.
      disableESTransforms: true,
      // A notebook cell's import is how other cells see the name; it is never "unused".
      keepUnusedImports: true,
      ...(sourceName === undefined
        ? {}
        : { filePath: "sucrase-in", sourceMapOptions: { compiledFilename: "sucrase-out" } }),
    }));
  } catch (e) {
    // Report the line in the cell, not in the shifted source, and without the file name sucrase
    // prefixes once it is given one (`filePath`, for the map).
    const message = String((e as Error)?.message ?? e).replace(
      /^Error transforming sucrase-in: /,
      "",
    );
    throw new SyntaxError(
      message.replace(/\((\d+):(\d+)\)$/, (_, line, column) => `(${Number(line) - 1}:${column})`),
    );
  }
  const newline = code.indexOf("\n");
  const prefix = code.slice(0, newline);
  const cut = new MagicString(code).remove(0, newline + 1);
  const helpers = new Map<string, string>();
  for (const [, specifiers = "", from = ""] of prefix.matchAll(
    /import \{([^}]*)\} from "([^"]*)";/g,
  )) {
    for (const specifier of specifiers.split(",")) {
      const [imported = "", local = imported] = specifier.trim().split(" as ");
      helpers.set(local, `${NAMESPACES[from]}.${imported}`);
    }
  }

  const kitInput = cut.toString();
  const t = transpile(kitInput, "js", options);
  const inputs = (t.inputs ?? []).filter((name) => !helpers.has(name));
  const args = (t.inputs ?? []).map(
    (name) => helpers.get(name) ?? (name === "display" ? "__displayReact" : name),
  );
  const url = (specifier: string) =>
    JSON.stringify(options.resolveImport ? options.resolveImport(specifier) : specifier);

  const wrapped = new MagicString(t.body)
    .prepend(
      [
        `async (${inputs.join(", ")}) => {`,
        `const [__jsxRuntime, __react, __reactDom] = await Promise.all([import(${url(JSX_RUNTIME)}), import(${url(REACT)}), import(${url(REACT_DOM_CLIENT)})]);`,
        "const __node = (value) => {",
        "if (!__react.isValidElement(value)) return value;",
        'const node = document.createElement("div");',
        "__reactDom.createRoot(node).render(value);",
        "return node;",
        "};",
        ...(inputs.includes("display")
          ? ["const __displayReact = (value) => display(__node(value));"]
          : []),
        "const __value = await (",
      ].join("\n"),
    )
    .append(
      [
        `)(${args.join(", ")});`,
        `return ${t.autodisplay ? "__node(__value)" : "__value"};`,
        "}",
      ].join("\n"),
    );
  const body = wrapped.toString();
  if (sourceName === undefined || !sucraseMap) return { ...t, body, inputs };

  const map = composeMaps(
    [
      mapOf(wrapped, "kit-out"),
      mapOfRewrite(kitInput, t.body, "kit-in"),
      mapOf(cut, "sucrase-out"),
      sucraseMap,
      mapOf(shifted, "source"),
    ],
    sourceName,
    source,
  );
  return map ? { ...t, body, inputs, map } : { ...t, body, inputs };
}
