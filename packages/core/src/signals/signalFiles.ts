import type { DiffFile } from "../diff/unified.js";
import { configRepoPath } from "../gateInputs.js";
import { isTestFile, keepTestFileText } from "../testFiles.js";
import { testLanguage } from "./testLines.js";

const WORKFLOWS_DIR = ".github/workflows/";

/** Whether a repo-relative path is a workflow file: `.yml` or `.yaml` directly under `.github/workflows/`. */
export function isWorkflowFile(path: string): boolean {
  if (!path.startsWith(WORKFLOWS_DIR)) return false;
  const name = path.slice(WORKFLOWS_DIR.length);
  return name !== "" && !name.includes("/") && (name.endsWith(".yml") || name.endsWith(".yaml"));
}

const PYTEST_CONFIG_NAMES: ReadonlySet<string> = new Set(["pytest.ini", "pyproject.toml", "setup.cfg", "tox.ini"]);

/**
 * Whether a repo-relative path is a pytest config file: its basename is exactly `pytest.ini`, `pyproject.toml`,
 * `setup.cfg` or `tox.ini`, at the root or nested. The list is this module's own (`testSources.ts` keeps its own).
 */
export function isPytestConfigFile(path: string): boolean {
  return PYTEST_CONFIG_NAMES.has(path.slice(path.lastIndexOf("/") + 1));
}

/**
 * Whether a repo-relative path is a snapshot file: some directory segment is exactly `__snapshots__`, or the basename
 * ends `.snap` or `.ambr`. Case-sensitive. By name only: it reads no file.
 */
export function isSnapshotFile(path: string): boolean {
  const segments = path.split("/");
  const basename = segments[segments.length - 1] ?? "";
  if (basename.endsWith(".snap") || basename.endsWith(".ambr")) return true;
  return segments.slice(0, -1).includes("__snapshots__");
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
 * files, every `package.json`, the pytest config files (`pytest.ini`, `pyproject.toml`, `setup.cfg`, `tox.ini`) and the
 * JavaScript, TypeScript and Python source files, each judged by its new and old path. Nothing else keeps text.
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
    isPytestConfigFile(file.path) ||
    isPytestConfigFile(file.oldPath) ||
    coverageSourceLanguage(file.path) !== null ||
    coverageSourceLanguage(file.oldPath) !== null ||
    (config !== null && (file.path === config || file.oldPath === config));
}

/**
 * The files whose kept text was cut at the bound (`textTruncated`) where a signal reads the added lines, so a finding
 * past the cut is not seen: a test file in a language TI03 reads (TI03, TI04; this covers the JavaScript and
 * TypeScript test files TI08, TI15 and TI16 read), a workflow file (TI11), a modified or renamed `package.json` (TI10),
 * a pytest config file (TI08), a JavaScript, TypeScript or Python file that is not a test file (TI13, and TI15's source
 * side) and the pharn-ci config in use (TI14). A deleted file has no added lines and TI01 already counts a cut test
 * file, so deleted files are left out; so are files no signal reads past the cut (a large fixture or snapshot under a
 * test directory). Sorted by path.
 */
export function textCutSignalFiles(diff: readonly DiffFile[], configPath?: string, repoRoot?: string): string[] {
  const config = configRepoPath(configPath, repoRoot);
  const cut = new Set<string>();
  for (const file of diff) {
    if (file.textTruncated !== true || file.status === "deleted" || file.binary === true) continue;
    const { path } = file;
    const test = isTestFile(path);
    const read =
      (test && testLanguage(path) !== null) ||
      isWorkflowFile(path) ||
      (isPackageJsonFile(path) && file.status !== "added") ||
      isPytestConfigFile(path) ||
      (!test && coverageSourceLanguage(path) !== null) ||
      (config !== null && path === config);
    if (read) cut.add(path);
  }
  return [...cut].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
