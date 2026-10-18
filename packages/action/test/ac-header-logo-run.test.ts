import { describe, expect, it } from "vitest";
import { harness, SCOPE } from "./harness.js";

// pr-comment-logo-2 AC-7. run() is loaded inside the test body: the AC tests are written before the build, so nothing
// the build changes may run while the file loads.

/** The one fixed logo line, written here so the test does not reuse the renderer's own constant. */
const LOGO =
  '<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">';

/** U+1F6E1 U+FE0F, the brand mark, and U+00B7, the separator, as the SPEC writes them. */
const FAIL_HEADING = "## \u{1F6E1}\u{FE0F} pharn-ci · ❌ Fail";

describe("action: the posted PR comment opens with the logo", () => {
  it("AC-7: a failing PR posts a comment that starts with marker, scope line, logo line, empty line and the Fail heading", async () => {
    const { COMMENT_MARKER, run } = await import("../src/run.js");
    const h = harness({ inputs: { threshold: "80" } });
    const report = await run(h.deps);
    expect(report?.verdict).toBe("fail");
    expect(h.comments).toHaveLength(1);
    const body = h.comments[0]?.body ?? "";
    const expected = `${COMMENT_MARKER}\n${SCOPE}\n${LOGO}\n\n${FAIL_HEADING}`;
    expect(body.slice(0, expected.length)).toBe(expected);
  });
});
