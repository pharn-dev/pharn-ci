import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The documents are read inside the test body: the build edits them, after this test.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** The lines after the first line starting `start` and before the next line matching `end` (to the end if none). */
function between(lines: string[], start: (line: string) => boolean, end: (line: string) => boolean): string[] {
  const from = lines.findIndex(start);
  if (from === -1) return [];
  const rest = lines.slice(from + 1);
  const to = rest.findIndex(end);
  return to === -1 ? rest : rest.slice(0, to);
}

/** Each numbered item (`^\d+\. `) joined with its indented continuation lines. */
function numberedItems(lines: string[]): string[] {
  const items: string[] = [];
  let current: string[] | undefined;
  for (const line of lines) {
    if (/^\d+\. /.test(line)) {
      if (current !== undefined) items.push(current.join("\n"));
      current = [line];
    } else if (current !== undefined && /^\s+\S/.test(line)) {
      current.push(line);
    } else if (current !== undefined) {
      items.push(current.join("\n"));
      current = undefined;
    }
  }
  if (current !== undefined) items.push(current.join("\n"));
  return items;
}

describe("policy v1 documentation", () => {
  it("AC-12: CHANGELOG names schema/policy.v1.json under Unreleased → Added; THREAT-MODEL has the policy surface row and the duplicate-key residual", () => {
    const changelog = read("CHANGELOG.md").split("\n");
    const unreleased = between(
      changelog,
      (l) => l.startsWith("## [0.4.0] - 2026-10-27"),
      (l) => l.startsWith("## ["),
    );
    const added = between(
      unreleased,
      (l) => l.startsWith("### Added"),
      (l) => l.startsWith("### "),
    );
    expect(added.some((l) => l.includes("schema/policy.v1.json"))).toBe(true);

    const threatModel = read("docs/THREAT-MODEL.md").split("\n");
    const surfaces = between(
      threatModel,
      (l) => l.startsWith("## 2."),
      (l) => l.startsWith("## 3."),
    );
    const policyRow = surfaces.filter(
      (l) =>
        l.startsWith("| ") && l.includes("validatePolicy") && l.includes("parsePolicyJson") && l.includes("policy"),
    );
    expect(policyRow.length).toBeGreaterThanOrEqual(1);

    const residuals = between(
      threatModel,
      (l) => l.startsWith("## 3."),
      (l) => l.startsWith("## 4."),
    );
    const duplicateKeys = numberedItems(residuals).filter(
      (item) => item.includes("duplicate") && item.includes("JSON.parse"),
    );
    expect(duplicateKeys).toHaveLength(1);
  });
});
