import { syntaxOf, type TestConfigKind } from "./kinds.js";
import { readIni } from "./readIni.js";
import { readJs } from "./readJs.js";
import { readJson } from "./readJson.js";
import { readToml } from "./readToml.js";
import { readYaml } from "./readYaml.js";
import { type ConfigValue, emptyObject, lookup, type ReadResult } from "./value.js";

/**
 * What reading one config text gives, for the rules to compare:
 * - `container`: the object (or, for a workspace, the array) the rules read;
 * - `absent`: the section, table or key that holds the settings is definitely not there;
 * - `notFound`: the config object itself could not be located (no export, an opaque export, a value that is not an
 *   object);
 * - `refused`: the text could not be read, with the reason code.
 */
export type ReadOutcome = { container: ConfigValue } | { absent: true } | { notFound: true } | { refused: string };

/** The object under `key` of the root: absent when unset, an open empty object when it may be set, else notFound. */
function nested(root: ConfigValue, key: string): ReadOutcome {
  if (root.type !== "object") return { notFound: true };
  const found = lookup(root, [key]);
  if (found === "unset") return { absent: true };
  if (found === "unknown") return { container: emptyObject(true) };
  return found.found.value.type === "object" ? { container: found.found.value } : { notFound: true };
}

function readSyntax(kind: TestConfigKind, path: string, text: string): ReadResult {
  switch (syntaxOf(kind, path)) {
    case "js":
      return readJs(path, text);
    case "json":
      return readJson(text);
    case "yaml":
      return readYaml(text);
    case "ini":
      return readIni(text, kind === "setup-cfg" ? "tool:pytest" : "pytest");
    case "toml":
      return readToml(text);
  }
}

/** Reads the text of a config file of this kind and locates the container its settings rules read. */
export function readTestConfig(kind: TestConfigKind, path: string, text: string): ReadOutcome {
  const result = readSyntax(kind, path, text);
  if (!result.ok) return { refused: result.reason };
  const root = result.root;
  if (root === null) return { absent: true };
  switch (kind) {
    case "vitest":
    case "vite":
      return nested(root, "test");
    case "package-json":
      return nested(root, "jest");
    case "vitest-workspace":
      return root.type === "array" ? { container: root } : { notFound: true };
    default:
      return root.type === "object" ? { container: root } : { notFound: true };
  }
}
