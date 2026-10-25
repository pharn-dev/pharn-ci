import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// release-readiness-v020: CHANGELOG.md records the Skylos benchmark and the new LIMITS section. They were added under
// Unreleased without editing an existing line; the 0.2.0 release moved that section under `## [0.2.0] - 2026-10-25`,
// added nothing else as a heading, and corrected the two Report v2 lines that still called the testIntegrity block
// empty and, before the tag, the two TI01 lines that said a renamed-away test file counts only when its removed lines
// define tests (CORRECTED). Files are read inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Current main before this increment: the base for the "still present" checks. */
const BEFORE = "b2c3a56373046ee6b64f913581a645f98240310c";

const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

const RELEASE_HEADING = "## [0.2.0] - 2026-10-25";
/**
 * The lines rewritten before the 0.2.0 tag: two said the testIntegrity block stays empty until signals ship, and two
 * said a test file renamed to a non-test path counts only when its removed lines define tests (a rename shows only
 * the lines it edits, so it now always counts).
 */
const CORRECTED = new Set([
  '  string `"1"`), every report carries a `testIntegrity` block (empty until test-integrity signals ship: mode',
  "  `warn`, source `default`, verdict `pass`), and the Action's `report.json` adds a `meta` block with run",
  "- Signal **TI01**, test file deleted: a deleted test file (or one renamed to a path that is not a test file) whose",
  "  removed lines define tests is reported in `testIntegrity.signals` and in one `TEST_INTEGRITY_TI01` message,",
]);

/** The section under the heading line that starts with `heading`, to the line before the next `## [` line. */
function changelogSection(text: string, heading: string): string[] {
  const all = lines(text);
  const start = all.findIndex((line) => line.startsWith(heading));
  if (start === -1) throw new Error(`CHANGELOG.md has no ${heading} section`);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## ["));
  return [all[start] as string, ...(end === -1 ? rest : rest.slice(0, end))];
}

describe("release-readiness-v020: CHANGELOG.md", () => {
  it("AC-8: the 0.2.0 section names Skylos, 2 of 9 and docs/LIMITS.md, keeps the Report v2 line and every earlier Unreleased line, and adds only the 0.2.0 heading", () => {
    const now = readFileSync(`${ROOT}CHANGELOG.md`, "utf8");
    const before = execFileSync("git", ["show", `${BEFORE}:CHANGELOG.md`], { cwd: ROOT, encoding: "utf8" });

    const section = changelogSection(now, RELEASE_HEADING);
    const body = normalize(section.join("\n"));
    for (const word of ["Skylos", "2 of 9", "docs/LIMITS.md", "Report v2", "schemaVersion", "report.v1.json"]) {
      expect(body, word).toContain(word);
    }

    const nowLines = new Set(section);
    const earlier = changelogSection(before, "## [Unreleased]")
      .slice(1)
      .filter((line) => line.trim() !== "" && !line.startsWith("### ") && !CORRECTED.has(line));
    expect(earlier.length).toBeGreaterThan(1);
    for (const line of earlier) expect(nowLines.has(line), line).toBe(true);

    const headings = (text: string) => lines(text).filter((line) => line.startsWith("## ["));
    const [unreleasedHeading, ...released] = headings(before);
    expect(headings(now)).toEqual([unreleasedHeading, RELEASE_HEADING, ...released]);
    expect(lines(now).filter((line) => CORRECTED.has(line))).toEqual([]);
  });
});
