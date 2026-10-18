import { describe, expect, it } from "vitest";
import { coverage, fakeDeps } from "./fake-deps.js";

// pr-comment-bold-look AC-9. main() is loaded inside the test body: the AC tests are written before the build, so
// nothing the build changes may run while the file loads.

/** U+1F6E1 U+FE0F, the brand mark, and U+00B7, the separator, as the SPEC writes them. */
const SHIELD = "\u{1F6E1}️";
const DOT = "·";

describe("pharn-ci check: markdown output", () => {
  it("AC-9: a passing check exits 0 and prints the branded Pass heading and the Diff coverage section", async () => {
    const { main, EXIT_OK } = await import("../src/main.js");
    const deps = fakeDeps(coverage);
    const code = await main(["check", "--coverage", "lcov.info", "--threshold", "71.42"], deps);
    expect(EXIT_OK).toBe(0);
    expect(code, deps.err).toBe(EXIT_OK);
    expect(deps.out).toContain(`## ${SHIELD} pharn-ci ${DOT} ✅ Pass`);
    expect(deps.out).toContain("### 🧪 Diff coverage");
  });
});
