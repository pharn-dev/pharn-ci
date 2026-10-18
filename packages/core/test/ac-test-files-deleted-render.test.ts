import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// buildReport(), check() and the renderer are loaded inside the test body: the AC tests are written before the
// deleted-test-file message and its hint exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CODE: string = "TEST_FILES_DELETED";

describe("renderMarkdown(): the deleted-test-file message", () => {
  it("AC-3: renders the TEST_FILES_DELETED text with a hint line, and the golden rendering is unchanged", async () => {
    const { buildReport } = await import("../src/report.js");
    const { check } = await import("../src/check.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const input = {
      version: "0.1.0",
      threshold: null,
      diffCoverage: null,
      agentSetup: { files: [] },
      deletedTestFiles: ["src/x.test.ts"],
    };
    const report = buildReport(input as Parameters<typeof buildReport>[0]);
    expectValidReport(report);
    const message = report.messages.find((m) => m.code === CODE);
    expect(message?.level).toBe("info");
    expect(message?.text).toContain("`src/x.test.ts`");

    const markdown = renderMarkdown(report);
    // The renderer escapes Markdown-active characters in every message text, so the code spans arrive as
    // escaped backticks, as for CONFIG_CHANGED_IN_DIFF (markdown.test.ts pins that escaping).
    const rendered = (message?.text ?? "<no TEST_FILES_DELETED message>").replace(/[\\`*_[\]#!|~]/g, "\\$&");
    expect(markdown).toContain(rendered);
    const markdownLines = markdown.split("\n");
    const at = markdownLines.findIndex((line) => line.includes(`\`${CODE}\``));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(markdownLines[at + 1]).toMatch(/^ {2}- Hint: \S/);

    // The golden inputs delete no test file, so their rendering stays byte for byte what fixtures/golden/ holds.
    const golden = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    expectValidReport(golden);
    expect(renderMarkdown(golden)).toBe(fixture("golden/report.md"));
  });
});
