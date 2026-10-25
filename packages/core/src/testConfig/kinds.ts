/** The test-runner config kinds TI09 reads. */
export type TestConfigKind =
  | "vitest"
  | "vite"
  | "vitest-workspace"
  | "jest"
  | "package-json"
  | "playwright"
  | "mocha"
  | "pytest-ini"
  | "tox-ini"
  | "setup-cfg"
  | "pyproject";

/** The syntax a config text is read as. */
export type ConfigSyntax = "js" | "json" | "yaml" | "ini" | "toml";

const JS_EXTENSIONS: ReadonlySet<string> = new Set(["ts", "mts", "cts", "js", "mjs", "cjs"]);

/** The config kind of `<prefix>.<js extension>`, or false. */
function hasJsName(basename: string, prefix: string): boolean {
  return basename.startsWith(`${prefix}.`) && JS_EXTENSIONS.has(basename.slice(prefix.length + 1));
}

/**
 * The config kind of a path, by basename alone and case-sensitive, or null for any other name. `.mocharc.jsonc`, a bare
 * `.mocharc` and `conftest.py` are test-config names for the sources but are never read by TI09.
 */
export function testConfigKind(path: string): TestConfigKind | null {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  if (hasJsName(basename, "vitest.config")) return "vitest";
  if (hasJsName(basename, "vite.config")) return "vite";
  if (hasJsName(basename, "vitest.workspace") || basename === "vitest.workspace.json") return "vitest-workspace";
  if (hasJsName(basename, "jest.config") || basename === "jest.config.json") return "jest";
  if (hasJsName(basename, "playwright.config")) return "playwright";
  switch (basename) {
    case "package.json":
      return "package-json";
    case ".mocharc.js":
    case ".mocharc.cjs":
    case ".mocharc.json":
    case ".mocharc.yml":
    case ".mocharc.yaml":
      return "mocha";
    case "pytest.ini":
      return "pytest-ini";
    case "tox.ini":
      return "tox-ini";
    case "setup.cfg":
      return "setup-cfg";
    case "pyproject.toml":
      return "pyproject";
    default:
      return null;
  }
}

/** Whether a kind is a file made for the test runner. A kind that shares its file with other tools is not. */
export function isDedicatedTestConfig(kind: TestConfigKind): boolean {
  return kind !== "package-json" && kind !== "pyproject" && kind !== "setup-cfg" && kind !== "tox-ini";
}

/** The syntax a config of this kind and path is written in. */
export function syntaxOf(kind: TestConfigKind, path: string): ConfigSyntax {
  switch (kind) {
    case "package-json":
      return "json";
    case "pytest-ini":
    case "tox-ini":
    case "setup-cfg":
      return "ini";
    case "pyproject":
      return "toml";
    default: {
      const basename = path.slice(path.lastIndexOf("/") + 1);
      if (basename.endsWith(".json")) return "json";
      if (basename.endsWith(".yml") || basename.endsWith(".yaml")) return "yaml";
      return "js";
    }
  }
}
