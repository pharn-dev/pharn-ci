import { describe, expect, it } from "vitest";
import { harness } from "./harness.js";

// pr-comment-verdict-callout AC-7. run() is loaded inside the test body: the AC tests are written before the build, so
// nothing the build changes may run while the file loads.

/** U+1F6E1 U+FE0F, the brand mark, and U+00B7, the separator, as the SPEC writes them. */
const FAIL_HEADING = "## \u{1F6E1}\u{FE0F} pharn-ci · ❌ Fail";

describe("action: the posted PR comment shows the verdict callout", () => {
  it("AC-7: a failing PR posts a comment whose Fail heading is followed by an empty line and the CAUTION callout", async () => {
    const { run } = await import("../src/run.js");
    const h = harness({ inputs: { threshold: "80" } });
    const report = await run(h.deps);
    expect(report?.verdict).toBe("fail");
    expect(h.comments).toHaveLength(1);

    const lines = (h.comments[0]?.body ?? "").split("\n");
    const at = lines.indexOf(FAIL_HEADING);
    expect(at, "the Fail heading").toBeGreaterThanOrEqual(0);
    expect(lines[at + 1]).toBe("");
    expect(lines[at + 2]).toBe("> [!CAUTION]");
    const content = lines[at + 3] ?? "";
    expect(content.startsWith("> **Fail** · Diff coverage of this change is "), content).toBe(true);
  });
});
