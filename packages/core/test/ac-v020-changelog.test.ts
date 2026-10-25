import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// release-readiness-v020: CHANGELOG.md records the Skylos benchmark and the new LIMITS section under Unreleased,
// without editing an existing line or adding a version heading. Files are read inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Current main before this increment: the base for the "still present" checks. */
const BEFORE = "b2c3a56373046ee6b64f913581a645f98240310c";

const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** The `## [Unreleased]` section: from its heading to the line before the next `## [` line. */
function unreleased(text: string): string[] {
  const all = lines(text);
  const start = all.findIndex((line) => line.startsWith("## [Unreleased]"));
  if (start === -1) throw new Error("CHANGELOG.md has no ## [Unreleased] section");
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## ["));
  return [all[start] as string, ...(end === -1 ? rest : rest.slice(0, end))];
}

describe("release-readiness-v020: CHANGELOG.md", () => {
  it("AC-8: Unreleased names Skylos, 2 of 9 and docs/LIMITS.md, keeps the Report v2 line and every earlier line, and the ## [ headings are unchanged", () => {
    const now = readFileSync(`${ROOT}CHANGELOG.md`, "utf8");
    const before = execFileSync("git", ["show", `${BEFORE}:CHANGELOG.md`], { cwd: ROOT, encoding: "utf8" });

    const section = unreleased(now);
    const body = normalize(section.join("\n"));
    for (const word of ["Skylos", "2 of 9", "docs/LIMITS.md", "Report v2", "schemaVersion", "report.v1.json"]) {
      expect(body, word).toContain(word);
    }

    const nowLines = new Set(section);
    const earlier = unreleased(before).filter((line) => line.trim() !== "");
    expect(earlier.length).toBeGreaterThan(1);
    for (const line of earlier) expect(nowLines.has(line), line).toBe(true);

    const headings = (text: string) => lines(text).filter((line) => line.startsWith("## ["));
    expect(headings(now)).toEqual(headings(before));
  });
});
