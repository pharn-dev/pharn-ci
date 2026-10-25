import { configRepoPath } from "../gateInputs.js";
import { keepTestFileText } from "../testFiles.js";

const WORKFLOWS_DIR = ".github/workflows/";

/** Whether a repo-relative path is a workflow file: `.yml` or `.yaml` directly under `.github/workflows/`. */
export function isWorkflowFile(path: string): boolean {
  if (!path.startsWith(WORKFLOWS_DIR)) return false;
  const name = path.slice(WORKFLOWS_DIR.length);
  return name !== "" && !name.includes("/") && (name.endsWith(".yml") || name.endsWith(".yaml"));
}

/**
 * The files whose added and removed line text the diff reader keeps for the test-integrity signals: the test files,
 * the pharn-ci config in use (`.pharn/ci.yml`, or the path given, when it is inside the repository) and the workflow
 * files, each judged by its new and old path. Nothing else keeps text.
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
    (config !== null && (file.path === config || file.oldPath === config));
}
