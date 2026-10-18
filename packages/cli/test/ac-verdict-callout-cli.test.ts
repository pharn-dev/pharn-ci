import { describe, expect, it } from "vitest";
import { coverage, fakeDeps } from "./fake-deps.js";

// pr-comment-verdict-callout AC-8. main() is loaded inside the test body: the AC tests are written before the build,
// so nothing the build changes may run while the file loads.

/** U+1F6E1 U+FE0F, the brand mark, and U+00B7, the separator, as the SPEC writes them. */
const PASS_HEADING = "## \u{1F6E1}\u{FE0F} pharn-ci · ✅ Pass";

describe("pharn-ci check: markdown output shows the verdict callout", () => {
  it("AC-8: a passing check exits 0 and prints the Pass heading, an empty line and the TIP callout", async () => {
    const { main, EXIT_OK } = await import("../src/main.js");
    const deps = fakeDeps(coverage);
    const code = await main(["check", "--coverage", "lcov.info", "--threshold", "71.42"], deps);
    expect(EXIT_OK).toBe(0);
    expect(code, deps.err).toBe(EXIT_OK);

    const lines = deps.out.split("\n");
    const at = lines.indexOf(PASS_HEADING);
    expect(at, "the Pass heading").toBeGreaterThanOrEqual(0);
    expect(lines[at + 1]).toBe("");
    expect(lines[at + 2]).toBe("> [!TIP]");
    const content = lines[at + 3] ?? "";
    expect(content.startsWith("> **Pass** · "), content).toBe(true);
  });
});
