import {
  type TranspiledJavaScript,
  type TranspileOptions,
  transpile,
} from "@observablehq/notebook-kit";
import { transform } from "sucrase";

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
 */
export function transpileJsx(
  source: string,
  mode: "jsx" | "tsx",
  options: TranspileOptions = {},
): TranspiledJavaScript {
  // The source goes in one line down, so sucrase's import prefix has line 1 to itself and is cut
  // off exactly: matching import declarations at the head of the output instead would also
  // take the author's own first `import` with it.
  let code: string;
  try {
    ({ code } = transform(`\n${source}`, {
      transforms: mode === "tsx" ? ["jsx", "typescript"] : ["jsx"],
      jsxRuntime: "automatic",
      jsxImportSource: REACT,
      production: true,
      // Leave modern syntax alone: notebook-kit parses it, and the page runs in a browser.
      disableESTransforms: true,
      // A notebook cell's import is how other cells see the name; it is never "unused".
      keepUnusedImports: true,
    }));
  } catch (e) {
    // Report the line in the cell, not in the shifted source.
    const message = String((e as Error)?.message ?? e);
    throw new SyntaxError(
      message.replace(/\((\d+):(\d+)\)$/, (_, line, column) => `(${Number(line) - 1}:${column})`),
    );
  }
  const newline = code.indexOf("\n");
  const prefix = code.slice(0, newline);
  const helpers = new Map<string, string>();
  for (const [, specifiers = "", from = ""] of prefix.matchAll(
    /import \{([^}]*)\} from "([^"]*)";/g,
  )) {
    for (const specifier of specifiers.split(",")) {
      const [imported = "", local = imported] = specifier.trim().split(" as ");
      helpers.set(local, `${NAMESPACES[from]}.${imported}`);
    }
  }

  const t = transpile(code.slice(newline + 1), "js", options);
  const inputs = (t.inputs ?? []).filter((name) => !helpers.has(name));
  const args = (t.inputs ?? []).map(
    (name) => helpers.get(name) ?? (name === "display" ? "__displayReact" : name),
  );
  const url = (specifier: string) =>
    JSON.stringify(options.resolveImport ? options.resolveImport(specifier) : specifier);

  const body = [
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
    `const __value = await (${t.body})(${args.join(", ")});`,
    `return ${t.autodisplay ? "__node(__value)" : "__value"};`,
    "}",
  ].join("\n");

  return { ...t, body, inputs };
}
