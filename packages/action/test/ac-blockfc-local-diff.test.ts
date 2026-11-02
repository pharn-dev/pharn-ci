import { describe, expect, it } from "vitest";
import { harness } from "./harness.js";

// run() is loaded inside the test body: the AC test is written before the Action stops falling back to the compare
// API on a failed local diff (review HIGH 4, block-fails-closed-unavailable), so nothing that depends on it may run
// while the file loads. With the harness default the PR base resolves locally; `diffError` makes the local `git diff`
// reject.

/** The PR base sha of the harness context (`PR_CONTEXT`). */
const BASE = "a".repeat(40);
const GIT_ERROR = `fatal: bad revision '${BASE}...HEAD'`;

describe("the Action when the PR base resolves locally and the local git diff fails", () => {
  for (const mode of ["", "off"]) {
    it(`AC-8: the step fails once naming the base, the git error and fetch-depth: 0, and the compare API is not called (test-integrity "${mode}")`, async () => {
      const { run } = await import("../src/run.js");
      const h = harness({ inputs: { "test-integrity": mode }, diffError: new Error(GIT_ERROR) });
      await run(h.deps);

      expect(
        h.gitCalls.some((args) => args[0] === "diff"),
        "the local git diff was attempted",
      ).toBe(true);
      expect(
        h.apiCalls.filter((c) => c.startsWith("compare ")),
        "the compare API is not called",
      ).toEqual([]);
      expect(h.failed, "exactly one failure message").toHaveLength(1);
      const message = h.failed[0] ?? "";
      expect(message, "names the base").toContain(BASE);
      expect(message, "includes the git error").toContain(GIT_ERROR);
      expect(message, "names fetch-depth: 0").toContain("fetch-depth: 0");
    });
  }
});
