import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC tests are written before TI03 and TI04 exist, so nothing the build
// adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const EARLIER = ["TI01", "TI11", "TI14"];

/**
 * What the TI01, TI11 and TI14 fixtures give in mode block before this increment: their signals (id, severity,
 * path:line). Recorded from check() at the base commit be11155.
 */
const BEFORE: Record<string, string[]> = {
  "TI01/block-code-stays.diff": ["TI01 block src/__tests__/b.test.ts"],
  "TI01/block-rename-away.diff": ["TI01 block src/x.test.ts"],
  "TI01/block-root-tests.diff": ["TI01 block tests/test_a.py"],
  // Re-pinned by the name-only-moves change: TI01's same-stem rule no longer softens a deleted test file without body
  // evidence (a name is the part a change controls most easily), and a diff-only check has none, so the two migration
  // diffs are now a block.
  "TI01/info-migration-mjs.diff": ["TI01 block lib/x.test.js"],
  "TI01/info-migration-ts.diff": ["TI01 block lib/x.test.js"],
  "TI01/info-package-removed.diff": ["TI01 info packages/a/__tests__/y.test.ts"],
  "TI01/info-with-source.diff": ["TI01 info src/foo.test.ts"],
  "TI01/pass-binary.diff": [],
  "TI01/pass-fixture-json.diff": [],
  "TI01/pass-helper.diff": [],
  "TI01/pass-init-py.diff": [],
  "TI11/block-test-step-removed.diff": ["TI11 block .github/workflows/ci.yml:35"],
  "TI11/block-trigger-flow.diff": ["TI11 block .github/workflows/ci.yml:3"],
  "TI11/block-trigger-removed.diff": ["TI11 block .github/workflows/ci.yml:17"],
  "TI11/block-workflow-deleted.diff": [
    "TI11 block .github/workflows/test.yml:3",
    "TI11 block .github/workflows/test.yml:11",
  ],
  "TI11/pass-action-bump.diff": [],
  "TI11/pass-comment-removed.diff": [],
  "TI11/pass-continue-expression.diff": [],
  "TI11/pass-if-always.diff": [],
  "TI11/pass-matrix-grown.diff": [],
  "TI11/pass-non-workflow.diff": [],
  "TI11/pass-pure-rename.diff": [],
  "TI11/pass-step-moved.diff": [],
  "TI11/pass-step-reflowed.diff": [],
  "TI11/pass-timeout-fifteen.diff": [],
  "TI11/pass-trigger-kept.diff": [],
  "TI11/warn-continue-on-error.diff": ["TI11 warn .github/workflows/ci.yml:41"],
  "TI11/warn-if-event.diff": ["TI11 warn .github/workflows/ci.yml:41"],
  "TI11/warn-if-false.diff": ["TI11 warn .github/workflows/ci.yml:41"],
  "TI11/warn-matrix-reduced.diff": ["TI11 warn .github/workflows/ci.yml:22"],
  "TI11/warn-timeout-one.diff": ["TI11 warn .github/workflows/ci.yml:27"],
  "TI14/block-config-deleted.diff": ["TI14 block .pharn/ci.yml:4"],
  "TI14/block-exclude-appended.diff": ["TI14 block .pharn/ci.yml:7"],
  "TI14/block-exclude-block.diff": ["TI14 block .pharn/ci.yml:6"],
  "TI14/block-exclude-flow.diff": ["TI14 block .pharn/ci.yml:5"],
  "TI14/block-threshold-lowered.diff": ["TI14 block .pharn/ci.yml:4"],
  "TI14/block-threshold-removed.diff": ["TI14 block .pharn/ci.yml:4"],
  "TI14/pass-exclude-moved.diff": [],
  "TI14/pass-exclude-removed.diff": [],
  "TI14/pass-file-item-added.diff": [],
  "TI14/pass-threshold-added.diff": [],
  "TI14/pass-threshold-moved.diff": [],
  "TI14/pass-threshold-raised.diff": [],
  "TI14/pass-unrelated-setup.diff": [],
};

/**
 * sha256 of the JSON list of { fixture, signals, messages } over the fixtures above, in that order, holding the
 * full TI01, TI11 and TI14 signals (details included) and the TEST_INTEGRITY_TI01, _TI11 and _TI14 messages, as
 * check() gave them at the base commit be11155.
 */
// Re-pinned by the name-only-moves change: only the two TI01 migration records changed (info to block, new detail),
// because TI01's same-stem rule now needs body evidence, not a name alone.
const BEFORE_DIGEST = "fdc37bb7a6e2cd78c6a3af66a48371da5805a01b53d19a83df5099c2b4f6277c";

async function run(diff: string, exclude: string[] = [], files = "test-files-deleted/files.txt") {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture(files).trim().split("\n"),
    exclude,
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

type Report = Awaited<ReturnType<typeof run>>;

const earlierSignals = (report: Report) =>
  report.testIntegrity.signals.filter((signal) => EARLIER.includes(String(signal.id)));
const earlierMessages = (report: Report) =>
  report.messages.filter((m) => EARLIER.some((id) => (m.code as string) === `TEST_INTEGRITY_${id}`));
const summary = (report: Report) =>
  earlierSignals(report).map((s) => `${s.id} ${s.severity} ${s.path}${s.line === null ? "" : `:${s.line}`}`);
const ours = (report: Report) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI03" || String(signal.id) === "TI04");

/** The exclusion patterns the TI14 fixture that appends an item is judged against: the items it appends. */
function excludeFor(name: string, text: string): string[] {
  if (name !== "TI14/block-exclude-appended.diff") return [];
  return text
    .split("\n")
    .filter((line) => /^\+\s+- /.test(line))
    .map((line) => line.replace(/^\+\s+- /, "").replace(/^["']|["']$/g, ""));
}

describe("TI03 and TI04 leave the earlier signals and fixtures alone", () => {
  it("AC-13: the TI01, TI11 and TI14 fixtures give the same signals and messages as before, and the golden diff stays quiet", async () => {
    // Control: a TI01 fixture with an existing test turned into a skip in another file keeps its TI01 signal and
    // messages exactly, and gains one TI03 signal.
    const ti01 = fixture("test-integrity/TI01/block-code-stays.diff");
    const skip = [
      "diff --git a/src/user.test.ts b/src/user.test.ts",
      "index 1111111..2222222 100644",
      "--- a/src/user.test.ts",
      "+++ b/src/user.test.ts",
      "@@ -12,1 +12,1 @@",
      "-it('creates a user', () => {",
      "+it.skip('creates a user', () => {",
      "",
    ].join("\n");
    const alone = await run(ti01);
    const combined = await run(ti01 + skip);
    expect(earlierSignals(combined)).toEqual(earlierSignals(alone));
    expect(earlierMessages(combined)).toEqual(earlierMessages(alone));
    expect(ours(combined).map((s) => `${s.id} ${s.path}:${s.line}`)).toEqual(["TI03 src/user.test.ts:12"]);

    // Every earlier fixture: the same signals as before, no TI03 or TI04, and the same details and messages.
    const records: Array<{ fixture: string; signals: unknown[]; messages: unknown[] }> = [];
    for (const [name, expected] of Object.entries(BEFORE)) {
      const text = fixture(`test-integrity/${name}`);
      const report = await run(text, excludeFor(name, text));
      expect(summary(report), name).toEqual(expected);
      expect(ours(report), name).toEqual([]);
      records.push({ fixture: name, signals: earlierSignals(report), messages: earlierMessages(report) });
    }
    expect(createHash("sha256").update(JSON.stringify(records)).digest("hex")).toBe(BEFORE_DIGEST);

    // The golden diff adds no skip or narrowing marker to a test file.
    const golden = await run(fixture("golden/pr.diff"), [], "golden/files.txt");
    expect(golden.testIntegrity.signals).toEqual([]);
  });
});
