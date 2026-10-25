/** The script kinds the test index parses a file as. */
export type TestScriptKind = "ts" | "tsx" | "js" | "jsx";

/**
 * The script kind for a path, from the last extension of its basename, folded to lowercase. `ts`, `mts` and `cts` are
 * TS; `tsx` is TSX; `js`, `mjs` and `cjs` are JS; `jsx` is JSX. Anything else, and a name with no extension, is TS.
 */
export function scriptKindOf(path: string): TestScriptKind {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const base = path.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  if (dot === -1) return "ts";
  switch (base.slice(dot + 1).toLowerCase()) {
    case "tsx":
      return "tsx";
    case "js":
    case "mjs":
    case "cjs":
      return "js";
    case "jsx":
      return "jsx";
    default:
      return "ts";
  }
}
