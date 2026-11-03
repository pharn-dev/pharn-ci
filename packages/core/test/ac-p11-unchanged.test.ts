import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { foldCoverageBar } from "./helpers.js";

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
      // Re-pinned for comment-coverage-bar (the diff-coverage bar in the PR comment): the four golden report.md files
      // gained the bar line on purpose. Each must be modified, never added or deleted, and folding the bar line (and
      // the empty line under it) back out must give its content at the base byte for byte.
      const barred = /^M\t(fixtures\/golden(?:-cobertura|-exclusions|-multi)?\/report\.md)$/.exec(line);
      if (barred !== null) {
        expect(foldCoverageBar(read(barred[1] as string)), line).toBe(git("show", `${BASE}:${barred[1]}`));
        continue;
      }
      // Re-pinned for markdown-byte-compare (review SPEC finding 29): markdown.test.ts's two snapshots moved, unchanged,
      // into these two new committed files.
      if (/^A\tfixtures\/markdown\/(?:missing|no-coverable)\.md$/.test(line)) continue;
      // Re-pinned for E3 item 23 (policy settings) and E3 item 24 (P07): their new fixtures under
      // fixtures/policy-settings/ and fixtures/policy-rules/p07/ are added too.
      // Re-pinned for the 2026-11-01 review fixes: their new TI10 and TI14 fixture files are added too.
      // Re-pinned for ti03-skip-evasion (review B1): its new case directories under fixtures/test-integrity/TI03/ are
      // added too; an existing TI03 fixture that changed would still show as modified, not added.
      // Re-pinned for fix/ti09-opaque-head (review finding 22): its four new TI09 case directories are added too.
      // Re-pinned for fix/unparsed-added-test-file: its six new case directories under
      // fixtures/test-integrity/index-unavailable/ and two under fixtures/test-integrity/TI01/ are added too.
      // Re-pinned for js-ts-extensions (review 2026-11-01, finding 13): its four new case directories under
      // fixtures/test-integrity/TI01/, TI04/ and TI13/ are added too (the TI03 one is covered above).
      expect(line, "a fixture change").toMatch(
        /^A\tfixtures\/policy-rules\/(?:p11|p07)\/[^/]+\/[^/]+$|^A\tfixtures\/policy-settings\/[^\t]+$|^A\tfixtures\/test-integrity\/TI03\/[^\t]+$|^A\tfixtures\/test-integrity\/(?:TI10\/(?:block-colon-only|block-true-only|block-true-or-run|pass-true-then-run)|TI14\/block-threshold-(?:emptied|lowered-nbsp-comment|padded-past-cap))\.diff$|^A\tfixtures\/test-integrity\/(?:TI01\/(?:block-test-mts-deleted|block-spec-cts-deleted)|TI04\/block-test-mts-it-only|TI13\/pass-test-mts-istanbul)\/[^\t]+$|^A\tfixtures\/test-integrity\/TI09\/(?:block-opaque-head|block-too-deep-head|pass-added-opaque-config|pass-opaque-base-and-head)\/[^\t]+$|^A\tfixtures\/test-integrity\/(?:index-unavailable\/(?:added-broken|added-parseable|added-python|added-six-broken|mixed|mixed-python)|TI01\/block-same-stem-(?:unparsed|dropped))\/[^\t]+$/,
      );
    }
    const untracked = git("ls-files", "--others", "--exclude-standard", "--", "fixtures/")
      .split("\n")
      .filter((l) => l.length > 0);
    for (const path of untracked) {
      // Re-pinned for settings-unparseable-fails-closed (review A3-F2): its new case directories under
      // fixtures/policy-settings/unparseable/ are untracked until committed. Re-pinned for fix/ti09-opaque-head (review
      // finding 22): so are its four new TI09 case directories. Re-pinned for js-ts-extensions (review 2026-11-01,
      // finding 13): so are its new TI01, TI04 and TI13 case directories. Re-pinned for fix/unparsed-added-test-file: so are
      // its new index-unavailable and TI01 case directories. Re-pinned for markdown-byte-compare (review
      // SPEC finding 29): so are the two files markdown.test.ts's snapshots moved into.
      if (/^fixtures\/markdown\/(?:missing|no-coverable)\.md$/.test(path)) continue;
      expect(path, "a new fixture").toMatch(
        /^fixtures\/policy-rules\/(?:p11|p07)\/[^/]+\/[^/]+$|^fixtures\/test-integrity\/TI03\/[^\t]+$|^fixtures\/test-integrity\/(?:TI10\/(?:block-colon-only|block-true-only|block-true-or-run|pass-true-then-run)|TI14\/block-threshold-(?:emptied|lowered-nbsp-comment|padded-past-cap))\.diff$|^fixtures\/policy-settings\/unparseable\/[^\t]+$|^fixtures\/test-integrity\/(?:TI01\/(?:block-test-mts-deleted|block-spec-cts-deleted)|TI04\/block-test-mts-it-only|TI13\/pass-test-mts-istanbul)\/[^\t]+$|^fixtures\/test-integrity\/TI09\/(?:block-opaque-head|block-too-deep-head|pass-added-opaque-config|pass-opaque-base-and-head)\/[^\t]+$|^fixtures\/test-integrity\/(?:index-unavailable\/(?:added-broken|added-parseable|added-python|added-six-broken|mixed|mixed-python)|TI01\/block-same-stem-(?:unparsed|dropped))\/[^\t]+$/,
      );
    }

    // Part A's tests: unchanged, except the one deliberate update in the events test.
    const partA = git("ls-files", "--", "packages/*/test/ac-agentpr-*.test.ts")
      .split("\n")
      // The 0.4.0 release PR moved ac-agentpr-docs.test.ts's CHANGELOG reads from Unreleased to the 0.4.0 section.
      .filter(
        (p) =>
          p.length > 0 &&
          p !== "packages/action/test/ac-agentpr-action-events.test.ts" &&
          p !== "packages/core/test/ac-agentpr-docs.test.ts",
      );
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
