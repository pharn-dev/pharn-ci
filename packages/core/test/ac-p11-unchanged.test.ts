import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// E3 item 24a part B (P11), AC-25. Reads the tree with git against the base commit and runs four existing whole-report
// test files in a child vitest; nothing the build adds is loaded here. The child's PHARN_TEST_RESULTS is removed, so
// vitest.config.ts never points it at the gate's own results file; its JSON report goes to a temporary file. The three
// dist-freshness tests the PLAN's Risks name (they compare a fresh bundle with the committed dist, which this pipeline
// does not rebuild) are not run here.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "93376a9";
const MARK = "E3 item 24a part B (P11)";
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** The tests the PLAN lists as deliberately updated; each must carry a comment naming this item. */
const DELIBERATE = [
  "packages/action/test/ac-agentpr-action-events.test.ts",
  "packages/action/test/ac-pyparity2-unchanged.test.ts",
  "packages/core/test/ac-precision-v030-schema.test.ts",
  "packages/core/test/ac-secrets-repin.test.ts",
  "packages/core/test/ac-upload-schema.test.ts",
  "packages/core/test/ac-polrules-docs.test.ts",
  "packages/core/test/ac-upload-docs.test.ts",
];

/** The whole-report tests that must pass unchanged. */
const WHOLE_REPORT = [
  "packages/action/test/ac-stream-action.test.ts",
  "packages/cli/test/ac-stream-adapters.test.ts",
  "packages/action/test/ac-agentpr-action-pr.test.ts",
  "packages/action/test/ac-policy3-other-keys.test.ts",
];

interface AssertionResult {
  title: string;
  status: string;
  failureMessages: string[];
}
interface JsonReport {
  numFailedTests: number;
  numPendingTests: number;
  testResults: { name: string; status: string; message?: string; assertionResults: AssertionResult[] }[];
}

describe("existing tests, fixtures and goldens stay as they are", () => {
  it("AC-25: only new fixtures under fixtures/policy-rules/p11/, part A's tests unchanged but the events AC-13 case, every deliberate update marked, and the named whole-report tests pass", () => {
    // Fixtures: no tracked file under fixtures/ is modified or deleted; anything new is under fixtures/policy-rules/p11/.
    const changed = git("diff", "--name-status", "--no-renames", BASE, "--", "fixtures/")
      .split("\n")
      .filter((l) => l.length > 0);
    // E3 item 24 (P07): the fixtures of rule P07 are new too, so the two patterns below also accept p07.
    for (const line of changed) {
      // Re-pinned for E3 item 23 (policy settings) and E3 item 24 (P07): their new fixtures under
      // fixtures/policy-settings/ and fixtures/policy-rules/p07/ are added too.
      expect(line, "a fixture change").toMatch(
        /^A\tfixtures\/policy-rules\/(?:p11|p07)\/[^/]+\/[^/]+$|^A\tfixtures\/policy-settings\/[^\t]+$/,
      );
    }
    const untracked = git("ls-files", "--others", "--exclude-standard", "--", "fixtures/")
      .split("\n")
      .filter((l) => l.length > 0);
    for (const path of untracked) {
      expect(path, "a new fixture").toMatch(/^fixtures\/policy-rules\/(?:p11|p07)\/[^/]+\/[^/]+$/);
    }

    // Part A's tests: unchanged, except the one deliberate update in the events test.
    const partA = git("ls-files", "--", "packages/*/test/ac-agentpr-*.test.ts")
      .split("\n")
      .filter((p) => p.length > 0 && p !== "packages/action/test/ac-agentpr-action-events.test.ts");
    expect(partA).toContain("packages/core/test/ac-agentpr-monotone.test.ts");
    expect(partA).toContain("packages/action/test/ac-agentpr-action-pr.test.ts");
    expect(git("diff", "--name-only", BASE, "--", ...partA)).toBe("");

    // Each deliberate update carries a comment naming this item.
    for (const path of DELIBERATE) {
      const lines = read(path).split("\n");
      expect(
        lines.some((l) => /^\s*(\/\/|\/\*|\*)/.test(l) && l.includes(MARK)),
        `${path} names "${MARK}" in a comment`,
      ).toBe(true);
    }
    // The events test's no-meta case now expects the commits call and still records no isAgentPr.
    const events = read("packages/action/test/ac-agentpr-action-events.test.ts");
    expect(events).toContain("expect(withoutMeta.commitCalls).toEqual([[7, 1]]);");
    expect(events).toContain('expect(withoutMeta.text).not.toContain("isAgentPr");');

    // The whole-report tests, run in a child vitest.
    const outDir = mkdtempSync(join(tmpdir(), "pharn-ci-p11-unchanged-"));
    const out = join(outDir, "report.json");
    try {
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.PHARN_TEST_RESULTS;
      const child = spawnSync(
        process.execPath,
        [
          join(ROOT, "node_modules/vitest/vitest.mjs"),
          "run",
          ...WHOLE_REPORT,
          "--reporter=json",
          `--outputFile=${out}`,
        ],
        { cwd: ROOT, env, encoding: "utf8", timeout: 420_000 },
      );
      expect(
        existsSync(out),
        `the child wrote its JSON report (exit ${child.status}): ${child.stderr.slice(-2000)}`,
      ).toBe(true);
      const report = JSON.parse(readFileSync(out, "utf8")) as JsonReport;
      for (const file of WHOLE_REPORT) {
        const result = report.testResults.find((r) => r.name.split("\\").join("/").endsWith(file));
        expect(result, `${file} ran`).toBeDefined();
        const tests = result?.assertionResults ?? [];
        expect(tests.length, `${file}: tests collected`).toBeGreaterThan(0);
        for (const t of tests) expect(t.status, `${file} › ${t.title}: ${t.failureMessages.join("\n")}`).toBe("passed");
      }
      expect(report.numFailedTests).toBe(0);
      expect(report.numPendingTests).toBe(0);
      expect(child.status).toBe(0);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 480_000);
});
