import { describe, expect, it } from "vitest";
import { coverage, fakeDeps } from "./fake-deps.js";

// pr-comment-logo-2 AC-8. main() is loaded inside the test body: the AC tests are written before the build, so nothing
// the build changes may run while the file loads.

/** The one fixed logo line, written here so the test does not reuse the renderer's own constant. */
const LOGO =
  '<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">';

/** U+1F6E1 U+FE0F, the brand mark, and U+00B7, the separator, as the SPEC writes them. */
const PASS_HEADING = "## \u{1F6E1}\u{FE0F} pharn-ci · ✅ Pass";

describe("pharn-ci check: markdown output opens with the logo", () => {
  it("AC-8: a passing check exits 0 and prints the logo line first, then the Pass heading and the Diff coverage section", async () => {
    const { main, EXIT_OK } = await import("../src/main.js");
    const deps = fakeDeps(coverage);
    const code = await main(["check", "--coverage", "lcov.info", "--threshold", "71.42"], deps);
    expect(EXIT_OK).toBe(0);
    expect(code, deps.err).toBe(EXIT_OK);
    expect(deps.out.split("\n")[0]).toBe(LOGO);
    expect(deps.out).toContain(PASS_HEADING);
    expect(deps.out).toContain("### 🧪 Diff coverage");
  });
});
