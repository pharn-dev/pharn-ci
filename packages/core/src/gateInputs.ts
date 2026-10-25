import type { CoverageMap } from "./coverage/types.js";
import type { DiffFile } from "./diff/unified.js";
import { isAbsolutePath, normalizePath } from "./paths.js";

/** Config file read when no `--config` / `config` input names another. */
const DEFAULT_CONFIG_PATH = ".pharn/ci.yml";
const WORKFLOWS_DIR = ".github/workflows/";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The repo-relative path of the pharn-ci config in use (`.pharn/ci.yml` when none is named), or null when the
 * configured path is outside the repository, so it can match no diff path.
 */
export function configRepoPath(configPath: string | undefined, repoRoot: string | undefined): string | null {
  const config = normalizePath(configPath ?? DEFAULT_CONFIG_PATH, repoRoot);
  const inRepo = !isAbsolutePath(config) && config !== ".." && !config.startsWith("../");
  return inRepo ? config : null;
}

/**
 * The diff paths that edit the inputs of this check's own grade: the pharn-ci config in use (added, changed,
 * renamed from or to, or deleted) and anything under `.github/workflows/`. A config outside the repo can match
 * no diff path, so then only workflows count. Distinct, sorted in code-unit order.
 */
export function changedConfigPaths(
  diff: readonly DiffFile[],
  configPath: string | undefined,
  repoRoot: string | undefined,
): string[] {
  const config = configRepoPath(configPath, repoRoot);
  const found = new Set<string>();
  for (const file of diff) {
    for (const path of file.oldPath === file.path ? [file.path] : [file.path, file.oldPath]) {
      if ((config !== null && path === config) || path.startsWith(WORKFLOWS_DIR)) found.add(path);
    }
  }
  return [...found].sort(byCodeUnit);
}

/**
 * The repo-relative path of the coverage file when it is a tracked file (so the change under review can
 * supply its own coverage numbers), else null. A path left absolute or `..`-led is never tracked.
 */
export function trackedCoverageFile(
  file: string | undefined,
  repoRoot: string | undefined,
  repoFiles: readonly string[],
): string | null {
  if (file === undefined) return null;
  const path = normalizePath(file, repoRoot);
  return repoFiles.includes(path) ? path : null;
}

/**
 * Changed files the diff shows as binary although the coverage report knows them (typically `-diff` in
 * `.gitattributes`), so their added lines were not measured. `coverage` is keyed by the paths `parseCoverage`
 * already normalized. Distinct, sorted in code-unit order.
 */
export function binaryCoveredPaths(diff: readonly DiffFile[], coverage: CoverageMap): string[] {
  const found = new Set<string>();
  for (const file of diff) {
    if (file.binary !== true) continue;
    if (coverage.has(file.path)) found.add(file.path);
    else if (coverage.has(file.oldPath)) found.add(file.oldPath);
  }
  return [...found].sort(byCodeUnit);
}
