import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixture, foldCallout } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// pr-comment-logo-2 AC-2. check() and the renderer are loaded inside the test body: the AC tests are written before the
// build, so nothing the build changes may run while the file loads.

/** The one fixed logo line, written here so the test does not reuse the renderer's own constant. */
const LOGO =
  '<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">';

/** U+1F6E1 U+FE0F, the brand mark, and U+00B7, the separator, as the SPEC writes them. */
const HEADING = "## \u{1F6E1}\u{FE0F} pharn-ci · ❌ Fail";

/** sha256 of fixtures/golden/report.md as committed before this increment (no logo line), pinned here. */
const GOLDEN_MD_BEFORE_SHA256 = "a92f89d7fd9fa8c81d2a6de24df49b686becb8e4d3f84868a63ef2cde04511c9";

describe("renderMarkdown(): the golden report opens with the logo line", () => {
  it("AC-2: the golden rendering is the logo line, an empty line, then the committed report.md unchanged", async () => {
    const { check } = await import("../src/check.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    expectValidReport(report);
    expect(report.verdict).toBe("fail");

    const lines = renderMarkdown(report).split("\n");
    expect(lines[0]).toBe(LOGO);
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe(HEADING);

    // pr-comment-verdict-callout turned the overview line into a callout on purpose: lines 4 and 5 are its two lines,
    // and the hash below is taken after folding them back into the bare sentence.
    expect(lines[4]).toBe("> [!CAUTION]");
    expect(lines[5]?.startsWith("> **Fail** · ")).toBe(true);

    // Every line after the first two equals the committed golden from before this increment, byte for byte.
    // Report v2 changed the rendering in one place only, the footer's schema version, which is mapped back here.
    const rendered = foldCallout(lines.slice(2).join("\n"));
    expect(rendered).toContain("· report schema v2");
    const rest = rendered.replace("· report schema v2", "· report schema v1");
    expect(createHash("sha256").update(rest).digest("hex")).toBe(GOLDEN_MD_BEFORE_SHA256);
  });
});
