import { describe, expect, it } from "vitest";

// The shared fakes (packages/action/test/harness.ts and packages/cli/test/fake-deps.ts) and the code under test are
// loaded inside each test body: these AC tests are written before the build, which creates the shared fakes.

/** GitHub's limit on an issue comment body, in characters. Deliberately not the code's own constant. */
const GITHUB_COMMENT_LIMIT = 65_536;

describe("input guards and the comment size limit", () => {
  it('AC-2: the action fails the step for base-ref "-x"', async () => {
    const { run } = await import("../src/run.js");
    const { harness } = await import("./harness.js");
    const h = harness({ inputs: { "base-ref": "-x" } });

    expect(await run(h.deps)).toBeUndefined();
    expect(h.failed[0]).toContain('base-ref "-x" must not start with "-"');
  });

  it('AC-2: the CLI exits 2 for check --base "-x", with the reason on stderr and nothing on stdout', async () => {
    const { EXIT_ERROR, main } = await import("../../cli/src/main.js");
    const { fakeDeps } = await import("../../cli/test/fake-deps.js");
    const deps = fakeDeps({});

    expect(await main(["check", "--coverage", "x", "--base=-x"], deps)).toBe(EXIT_ERROR);
    expect(EXIT_ERROR).toBe(2);
    expect(deps.err).toContain('--base "-x" must not start with "-"');
    expect(deps.out).toBe("");
  });

  it("AC-2: MAX_COMMENT_LENGTH and every posted comment body stay within GitHub's 65_536 limit", async () => {
    const { MAX_COMMENT_LENGTH, run } = await import("../src/run.js");
    const { harness } = await import("./harness.js");
    // Enough long agent setup paths that the full report is far over the limit.
    const long = Array.from({ length: 50 }, (_, i) => `.claude/skills/${"x".repeat(2000)}${i}/SKILL.md`);
    const h = harness({ lsFiles: long });

    await run(h.deps);

    expect(MAX_COMMENT_LENGTH).toBeLessThanOrEqual(GITHUB_COMMENT_LIMIT);
    expect(h.posted.length).toBeGreaterThan(0);
    for (const body of h.posted) expect(body.length).toBeLessThanOrEqual(GITHUB_COMMENT_LIMIT);
    // The report really was over the limit, so the cap was exercised.
    expect(h.summary[0]?.length).toBeGreaterThan(GITHUB_COMMENT_LIMIT);
  });
});
