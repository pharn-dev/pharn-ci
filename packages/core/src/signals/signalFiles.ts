import { configRepoPath } from "../gateInputs.js";
import { keepTestFileText } from "../testFiles.js";

const WORKFLOWS_DIR = ".github/workflows/";

/** Whether a repo-relative path is a workflow file: `.yml` or `.yaml` directly under `.github/workflows/`. */
export function isWorkflowFile(path: string): boolean {
  if (!path.startsWith(WORKFLOWS_DIR)) return false;
  const name = path.slice(WORKFLOWS_DIR.length);
  return name !== "" && !name.includes("/") && (name.endsWith(".yml") || name.endsWith(".yaml"));
}

const JS_TS_EXTENSIONS: ReadonlySet<string> = new Set(["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"]);

/** Whether a repo-relative path is a `package.json`: its basename is exactly that, at the root or nested. */
export function isPackageJsonFile(path: string): boolean {
  return path.slice(path.lastIndexOf("/") + 1) === "package.json";
}

/**
 * The language of a source file by its extension: `jsts` for js, jsx, ts, tsx, mjs, cjs, mts and cts, `python` for py,
 * else null. Case-sensitive. A basename that only starts with a dot has no extension.
 */
export function coverageSourceLanguage(path: string): "jsts" | "python" | null {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = basename.slice(dot + 1);
  if (extension === "py") return "python";
  return JS_TS_EXTENSIONS.has(extension) ? "jsts" : null;
}

/**
 * The files whose added and removed line text the diff reader keeps for the test-integrity signals: the test files,
 * the pharn-ci config in use (`.pharn/ci.yml`, or the path given, when it is inside the repository), the workflow
 * files, every `package.json` and the JavaScript, TypeScript and Python source files, each judged by its new and old
 * path. Nothing else keeps text.
 */
export function keepSignalFileText(
  configPath?: string,
  repoRoot?: string,
): (file: { path: string; oldPath: string }) => boolean {
  const config = configRepoPath(configPath, repoRoot);
  return (file) =>
    keepTestFileText(file) ||
    isWorkflowFile(file.path) ||
    isWorkflowFile(file.oldPath) ||
    isPackageJsonFile(file.path) ||
    isPackageJsonFile(file.oldPath) ||
    coverageSourceLanguage(file.path) !== null ||
    coverageSourceLanguage(file.oldPath) !== null ||
    (config !== null && (file.path === config || file.oldPath === config));
}
