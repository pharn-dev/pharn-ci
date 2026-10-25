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

/** The summary table header and separator the comment-layout change gave the PR comment. */
const INTEGRITY_HEADER = "| Verdict | Diff coverage | Test integrity | Agent setup |";
const INTEGRITY_SEPARATOR = "| --- | --- | --- | --- |";

/**
 * Fold the summary table's Test integrity column (added by the comment-layout change on purpose) back out: the four
 * column header, separator and value row become the three-column table they were. Throws if the table is missing or
 * the value row does not have four cells, so a hash taken after folding still means "the output before the column".
 */
export function foldIntegrityColumn(markdown: string): string {
  const lines = markdown.split("\n");
  const at = lines.indexOf(INTEGRITY_HEADER);
  if (at === -1 || lines[at + 1] !== INTEGRITY_SEPARATOR) throw new Error("foldIntegrityColumn: no four-column table");
  const cells = (lines[at + 2] ?? "").split(" | ");
  if (cells.length !== 4) throw new Error(`foldIntegrityColumn: the value row has ${cells.length} cells`);
  lines.splice(
    at,
    3,
    "| Verdict | Diff coverage | Agent setup |",
    "| --- | --- | --- |",
    [cells[0], cells[1], cells[3]].join(" | "),
  );
  return lines.join("\n");
}
