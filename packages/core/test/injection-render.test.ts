import { describe, expect, it } from "vitest";
import { MESSAGE_FIXES } from "../src/fix/table.js";
import { check, type Report, renderMarkdown } from "../src/index.js";
import { fixture } from "./helpers.js";
import { addedFileDiff, injectionFixture } from "./injection-fixture.js";
import { expectValidReport } from "./schema.js";

// The 🧬 Content section of the PR comment: one line per finding with its hint, blocks first, folded after 10 and cut
// at 20; its messages left out of 💬 Messages while listed; nothing of the section on a clean report; hostile paths
// and details escaped like every other finding line.

function run(diff: string): Report {
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts"],
  } as never);
  expectValidReport(report);
  return report;
}

describe("the Content section", { timeout: 60_000 }, () => {
  it("lists each finding with its hint, blocks first, and leaves the listed signals' messages out of Messages", () => {
    const text = injectionFixture("literature-sample.diff.txt") + injectionFixture("trojan-source.diff.txt");
    const markdown = renderMarkdown(run(text));
    const section = markdown.slice(markdown.indexOf("### 🧬 Content"), markdown.indexOf("### 💬 Messages"));
    expect(section).toBe(
      [
        "### 🧬 Content",
        "",
        "- ❌ **PI01** `src/access.js:4` — right-to-left override U+202E and 3 more",
        `  - Hint: ${MESSAGE_FIXES.INJECTION_PI01.hint}`,
        "- ❌ **PI01** `src/commenting-out.js:4` — right-to-left override U+202E and 3 more",
        `  - Hint: ${MESSAGE_FIXES.INJECTION_PI01.hint}`,
        "- ⚠️ **PI02** `docs/translate.md:7` — phrase PH06 in an HTML comment",
        `  - Hint: ${MESSAGE_FIXES.INJECTION_PI02.hint}`,
        "- ⚠️ **PI03** `docs/translate.md:5` — phrase PH07",
        `  - Hint: ${MESSAGE_FIXES.INJECTION_PI03.hint}`,
        "- ⚠️ **PI03** `src/summarize.py:2` — phrase PH06",
        `  - Hint: ${MESSAGE_FIXES.INJECTION_PI03.hint}`,
        "",
        "",
      ].join("\n"),
    );
    expect(markdown).not.toContain("`INJECTION_PI0");
    expect(markdown).toContain("5 content findings, 2 blocking");
    // No invisible character is in the comment: the hints are fixed ASCII text (CORE-140: the comment's hint is the
    // code's fix.hint).
    for (const id of ["PI01", "PI02", "PI03", "PI04", "PI05"] as const) {
      expect(MESSAGE_FIXES[`INJECTION_${id}`].hint, id).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it("names a PI05 finding by path alone", () => {
    const markdown = renderMarkdown(run(injectionFixture("pi05-trigger.diff.txt")));
    expect(markdown).toContain("- ⚠️ **PI05** `node_modules/left-pad/CLAUDE.md` — claude-md file under node\\_modules/");
  });

  it("folds findings after 10 and cuts the list at 20, counting the rest", () => {
    const zwsp = String.fromCharCode(0x200b);
    const diff = addedFileDiff(
      "docs/a.md",
      Array.from({ length: 24 }, (_, i) => `line${zwsp}${i}`),
    );
    const report = run(diff);
    expect(report.injection?.signals).toHaveLength(20);
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("<details><summary>10 more findings</summary>");
    // 24 findings, 20 kept by the per-file cap: the message says so, and the section lists all 20 kept.
    expect(report.messages.find((m) => m.code === "INJECTION_PI01")?.text).toContain("4 more findings are not listed.");
  });

  it("renders nothing of the scan on a clean report", () => {
    const markdown = renderMarkdown(run(injectionFixture("pi03-clean.diff.txt")));
    expect(markdown).not.toContain("🧬");
    expect(markdown).not.toContain("content finding");
  });

  it("escapes a hostile path and detail of a hand-built report", () => {
    const report = run(injectionFixture("trojan-source.diff.txt"));
    const hostile = {
      ...report,
      injection: {
        signals: [
          { id: "PI01", severity: "block", path: "a`|b\n## x.md", line: 1, detail: "<img src=x> @team [x](y)" },
        ],
      },
    } as Report;
    const markdown = renderMarkdown(hostile);
    expect(markdown).toContain("`a'\\|b\uFFFD## x.md:1`");
    expect(markdown).toContain("&lt;img src=x&gt; @\u200Bteam \\[x\\](y)");
    expect(markdown).not.toContain("<img src=x");
    // Anything but an array of signals is no signal.
    const broken = { ...report, injection: { signals: "nope" } } as unknown as Report;
    expect(renderMarkdown(broken)).not.toContain("🧬");
  });
});
