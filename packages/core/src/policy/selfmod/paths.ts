import type { DiffFile } from "../../diff/unified.js";
import { isWorkflowFile } from "../../signals/signalFiles.js";
import { byCodeUnit } from "../../text.js";
import { isPolicyMcpPath, isPolicySettingsPath } from "../settings/paths.js";

/** The kinds of file rule P13 compares: agent settings, MCP configs, workflows and CODEOWNERS. */
export type SelfModificationClass = "settings" | "mcp" | "workflow" | "codeowners";

/** The three places GitHub looks for a CODEOWNERS file. */
const CODEOWNERS_PATHS: ReadonlySet<string> = new Set(["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"]);

/**
 * The P13 class of a repo-relative path, by name only: `.claude/settings.json` or `.claude/settings.local.json` at any
 * depth, `.mcp.json`, `.cursor/mcp.json` or `.vscode/mcp.json` at any depth, a workflow directly under
 * `.github/workflows/`, or `CODEOWNERS`, `.github/CODEOWNERS` or `docs/CODEOWNERS`; null for any other path.
 */
export function selfModificationClass(path: string): SelfModificationClass | null {
  if (isPolicySettingsPath(path)) return "settings";
  if (isPolicyMcpPath(path)) return "mcp";
  if (isWorkflowFile(path)) return "workflow";
  if (CODEOWNERS_PATHS.has(path)) return "codeowners";
  return null;
}

/**
 * The paths whose text P13 reads on each side, in the shape `selectTestSourcePaths` gives: the base side gets the old
 * path of a modified, deleted or renamed entry, the head side the path of an added, modified or renamed entry, each
 * only when that path has a P13 class. Each side is de-duplicated and sorted in code-unit order.
 */
export function selectSelfModificationPaths(diff: readonly DiffFile[]): { base: string[]; head: string[] } {
  const base = new Set<string>();
  const head = new Set<string>();
  for (const file of diff) {
    if (file.status !== "added" && selfModificationClass(file.oldPath) !== null) base.add(file.oldPath);
    if (file.status !== "deleted" && selfModificationClass(file.path) !== null) head.add(file.path);
  }
  return { base: [...base].sort(byCodeUnit), head: [...head].sort(byCodeUnit) };
}
