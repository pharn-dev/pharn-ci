import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// check() and renderMarkdown() are loaded inside each test body: these tests are written before CheckInput has
// `testIntegrityMode` and before the section exists, so nothing that depends on them may run while the file loads.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** The commit before this increment: Report v2 skeleton, no test-integrity section. */
const BEFORE = "e39cda3780c7df9c14c84018d187c2c9adfc7f9a";
const HEADING = "### 🔍 Test integrity";

const gitShow = (path: string) =>
  execFileSync("git", ["show", `${BEFORE}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });

async function render(mode?: "block" | "warn" | "off") {
  const { check } = await import("../src/check.js");
  const { renderMarkdown } = await import("../src/render/markdown.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: 80,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    ...(mode === undefined ? {} : { testIntegrityMode: { input: mode } }),
  } as never);
  return { report, markdown: renderMarkdown(report) };
}

describe("renderMarkdown: the Test integrity section", () => {
  it("AC-7: sits after Diff coverage and before Messages and Agent setup, with one fixed line per mode", async () => {
    const fixedLine = {
      warn: "No test-integrity findings (mode: warn).",
      block: "No test-integrity findings (mode: block).",
      off: "Test integrity is off for this run.",
    } as const;
    for (const mode of ["warn", "block", "off"] as const) {
      const { markdown } = await render(mode);
      const lines = markdown.split("\n");
      expect(
        lines.filter((l) => l === HEADING),
        mode,
      ).toHaveLength(1);
      const at = lines.indexOf(HEADING);
      const coverageAt = lines.indexOf("### 🧪 Diff coverage");
      const setupAt = lines.findIndex((l) => l.startsWith("### 🤖 Agent setup ("));
      const messagesAt = lines.findIndex((l) => l.startsWith("### 💬 Messages ("));
      expect(coverageAt, mode).toBeGreaterThanOrEqual(0);
      expect(at, mode).toBeGreaterThan(coverageAt);
      expect(at, mode).toBeLessThan(setupAt);
      if (messagesAt !== -1) expect(at, mode).toBeLessThan(messagesAt);

      expect(lines[at + 1], mode).toBe("");
      expect(lines[at + 2], mode).toBe(fixedLine[mode]);
      expect(lines[at + 3], mode).toBe("");
      expect(lines[at + 4]?.startsWith("### "), mode).toBe(true);
    }
  });

  it("AC-8: with no testIntegrityMode the report JSON is the golden one and the markdown differs by only the section", async () => {
    const { report, markdown } = await render();
    expect(`${JSON.stringify(report, null, 2)}\n`).toBe(gitShow("fixtures/golden/report.json"));

    const lines = markdown.split("\n");
    const at = lines.indexOf(HEADING);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines.slice(at, at + 4)).toEqual([HEADING, "", "No test-integrity findings (mode: warn).", ""]);
    lines.splice(at, 4);
    expect(lines.join("\n")).toBe(gitShow("fixtures/golden/report.md"));
  });
});
