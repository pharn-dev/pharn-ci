import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

export function fixture(path: string): string {
  return readFileSync(FIXTURES + path, "utf8");
}

/**
 * Fold the verdict callout back into the bare overview sentence it replaced: the `> [!TIP|WARNING|CAUTION]`
 * line and the `> **<Label>** · <sentence>` line become `<sentence>`. Throws if either line is missing, so a
 * hash taken after folding still means "the output before the callout" and proves the callout is the only change.
 */
export function foldCallout(markdown: string): string {
  const lines = markdown.split("\n");
  const marker = lines.findIndex((l) => /^> \[!(TIP|WARNING|CAUTION)\]$/.test(l));
  if (marker === -1) throw new Error("foldCallout: no alert marker line");
  const content = /^> \*\*(Pass|Warn|Fail)\*\* · (.*)$/.exec(lines[marker + 1] ?? "");
  if (content === null) throw new Error("foldCallout: no callout content line after the marker");
  lines.splice(marker, 2, content[2] as string);
  return lines.join("\n");
}
