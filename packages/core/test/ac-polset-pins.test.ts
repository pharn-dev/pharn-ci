import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { foldCoverageBar } from "./helpers.js";
import { withoutFixJson } from "./v090-codes.js";

// E3 item 23 (policy settings), AC-31. The pin test files are read inside the test body, and a child vitest runs the
// ones that must pass: the build edits some of them after this test is written. The base is main at 93376a9 (E3 item
// 22 merged), read with git. The child's PHARN_TEST_RESULTS is removed, so vitest.config.ts never points it at the
// gate's own results file, and CI=1 makes a mismatching golden fail instead of being written.
//
// The last check of ac-pyparity2-unchanged AC-20 (and the other tests that compare the committed packages/action/dist
// with a fresh bundle) is outside this criterion until `pnpm build` runs after the loop, so that file's edit is checked
// here as text only and it is not run.

const BASE = "93376a9";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const CODES = ["POLICY_P02", "POLICY_P03", "POLICY_P04", "POLICY_P05", "POLICY_P06", "POLICY_SETTINGS_INVALID"];

/** The pin tests the build edits on purpose, and the text each edit must leave in the file. */
const EDITED: Record<string, string[]> = {
  "packages/core/test/ac-upload-schema.test.ts": CODES,
  "packages/core/test/ac-polrules-docs.test.ts": ["POLICY_SETTINGS_INVALID"],
  "packages/action/test/ac-pyparity2-unchanged.test.ts": CODES,
  "packages/core/test/ac-precision-v030-schema.test.ts": CODES,
  "packages/core/test/ac-secrets-repin.test.ts": CODES,
  "packages/core/test/ac-upload-docs.test.ts": ["Org policy rules P02–P06"],
};
/** The pin tests that must pass with no edit. */
const UNCHANGED = [
  "packages/core/test/ac-polrules-render-list.test.ts",
  "packages/core/test/ac-polrules-render-table.test.ts",
  "packages/core/test/exclusions-golden.test.ts",
  "packages/core/test/ac-globs-golden.test.ts",
  "packages/core/test/ac-report-v2-golden.test.ts",
];
// Re-pinned by fix-hints (H6): every message and finding of a report now carries a `fix`, so these three tests read a
// report without it (or hash the committed golden without it) before comparing it with their pinned literal or digest.
// They are no longer byte-identical to the base; each must carry the marker, and all three still run in the child vitest
// below. The committed report JSON goldens changed the same way (see GOLDENS_WITH_FIX).
const EDITED_BY_FIX_HINTS = [
  "packages/core/test/ac-polrules-p09-settings.test.ts",
  "packages/core/test/golden.test.ts",
  "packages/action/test/ac-accept-signoff-default-golden.test.ts",
];
// Re-pinned by A8 step 1 (TESTS_NOT_EXERCISING_CHANGES): with readable test sources check() also runs the tests-exercise
// check, so ac-test-sources-golden takes its one warn message and testIntegrity.exercise out of the report made with
// sources before comparing it with the golden (exercise-repin.ts). It is no longer byte-identical to the base; it must
// carry the marker, and it still runs in the child vitest below.
const EDITED_BY_EXERCISE = ["packages/core/test/ac-test-sources-golden.test.ts"];
// Re-pinned by comment-coverage-bar (the diff-coverage bar in the PR comment): the three golden hash tests below fold the
// new bar line back out before hashing, on purpose. They are no longer byte-identical to the base; each must carry the
// marker, and all three still run in the child vitest below.
const EDITED_BY_COVERAGE_BAR = [
  "packages/core/test/ac-format-golden.test.ts",
  "packages/core/test/ac-header-logo-golden.test.ts",
  "packages/core/test/ac-verdict-callout-golden.test.ts",
];
/** The goldens comment-coverage-bar changed: each gained the bar line and nothing else. */
const BARRED_GOLDENS = [
  "fixtures/golden-cobertura/report.md",
  "fixtures/golden-exclusions/report.md",
  "fixtures/golden-multi/report.md",
  "fixtures/golden/report.md",
];
/** The report JSON goldens fix-hints changed: each gained a `fix` on each message and nothing else. */
const GOLDENS_WITH_FIX = [
  "fixtures/golden-cobertura/report.json",
  "fixtures/golden-multi/report.json",
  "fixtures/golden/report.json",
];
// Re-pinned by the review LOW batch: ac-ts-index-deps-dist.test.ts had its AC-14 title corrected on purpose (the title
// contradicted the assertions, which are unchanged). It is no longer byte-identical to the base; it must carry the
// marker, and it still runs in the child vitest below.
const EDITED_BY_REVIEW_LOW = ["packages/core/test/ac-ts-index-deps-dist.test.ts"];
// Re-pinned by block-fails-closed-unavailable (review HIGH 4): the two stream tests are edited on purpose (a failed local
// diff against a base that resolves now fails the step instead of falling back to the compare API). They are no
// longer byte-identical to the base; each must carry the marker, and both still run in the child vitest below.
const EDITED_BY_BLOCK_FAILS_CLOSED = [
  "packages/action/test/ac-stream-action.test.ts",
  "packages/cli/test/ac-stream-adapters.test.ts",
];
const RUN = [
  ...Object.keys(EDITED).filter((f) => !f.endsWith("ac-pyparity2-unchanged.test.ts")),
  ...EDITED_BY_BLOCK_FAILS_CLOSED,
  ...EDITED_BY_REVIEW_LOW,
  ...EDITED_BY_COVERAGE_BAR,
  ...EDITED_BY_EXERCISE,
  ...EDITED_BY_FIX_HINTS,
  ...UNCHANGED,
];
const MANIFESTS = [
  "package.json",
  "packages/action/package.json",
  "packages/cli/package.json",
  "packages/core/package.json",
  "packages/node-io/package.json",
];
const DEPENDENCY_KEYS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

interface JsonReport {
  numTotalTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests?: number;
  testResults: {
    name: string;
    status: string;
    assertionResults: { title: string; status: string; failureMessages: string[] }[];
  }[];
}

describe("the pins of E3 item 23", () => {
  it("AC-31: each deliberate pin edit is in place, the untouched pins and goldens are byte-identical to the base, the named pin tests pass, and no manifest gains a dependency", {
    timeout: 480_000,
  }, () => {
    for (const [file, words] of Object.entries(EDITED)) {
      const text = read(file);
      expect(text === git("show", `${BASE}:${file}`), `${file} carries its deliberate edit`).toBe(false);
      for (const word of words) expect(text, `${file} names ${word}`).toContain(word);
      expect(text, `${file}: the new comment names the item`).toContain("E3 item 23 (policy settings)");
    }
    for (const file of EDITED_BY_BLOCK_FAILS_CLOSED) {
      const text = read(file);
      expect(text === git("show", `${BASE}:${file}`), `${file} carries its deliberate edit`).toBe(false);
      expect(text, `${file}: the new comment names the change`).toContain("block-fails-closed-unavailable");
    }
    for (const file of EDITED_BY_REVIEW_LOW) {
      const text = read(file);
      expect(text === git("show", `${BASE}:${file}`), `${file} carries its deliberate edit`).toBe(false);
      expect(text, `${file}: the new comment names the change`).toContain("review LOW (AC-14 title)");
    }
    for (const file of EDITED_BY_COVERAGE_BAR) {
      const text = read(file);
      expect(text === git("show", `${BASE}:${file}`), `${file} carries its deliberate edit`).toBe(false);
      expect(text, `${file}: the new comment names the change`).toContain("comment-coverage-bar");
    }
    for (const file of EDITED_BY_EXERCISE) {
      const text = read(file);
      expect(text === git("show", `${BASE}:${file}`), `${file} carries its deliberate edit`).toBe(false);
      expect(text, `${file}: the new comment names the change`).toContain("A8 step 1");
    }
    for (const file of EDITED_BY_FIX_HINTS) {
      const text = read(file);
      expect(text === git("show", `${BASE}:${file}`), `${file} carries its deliberate edit`).toBe(false);
      expect(text, `${file}: the new comment names the change`).toContain("fix-hints (H6)");
    }
    for (const file of UNCHANGED) {
      expect(read(file) === git("show", `${BASE}:${file}`), `${file} is unchanged`).toBe(true);
    }
    const goldens = git(
      "diff",
      "--name-only",
      BASE,
      "--",
      "fixtures/golden",
      "fixtures/golden-cobertura",
      "fixtures/golden-exclusions",
      "fixtures/golden-multi",
    );
    // Re-pinned by comment-coverage-bar: the four golden report.md files gained the bar line on purpose; folding it
    // back out must give each one's content at the base byte for byte. No other golden changed.
    // Re-pinned by fix-hints (H6): three report JSON goldens gained a `fix` on each message on purpose; with their `fix`
    // objects taken out each must be its content at the base byte for byte (golden-exclusions has no message, so it is
    // unchanged).
    expect(
      goldens.trim().split("\n").sort(),
      "only the barred goldens and the goldens with fix under fixtures/golden* changed",
    ).toEqual([...BARRED_GOLDENS, ...GOLDENS_WITH_FIX].sort());
    for (const file of BARRED_GOLDENS) {
      expect(foldCoverageBar(read(file)), `${file}: only the bar line added`).toBe(git("show", `${BASE}:${file}`));
    }
    for (const file of GOLDENS_WITH_FIX) {
      expect(withoutFixJson(read(file)), `${file}: only the fix objects added`).toBe(git("show", `${BASE}:${file}`));
    }

    for (const manifest of MANIFESTS) {
      const now = JSON.parse(read(manifest)) as Record<string, Record<string, string> | undefined>;
      const before = JSON.parse(git("show", `${BASE}:${manifest}`)) as Record<
        string,
        Record<string, string> | undefined
      >;
      for (const key of DEPENDENCY_KEYS) {
        const added = Object.keys(now[key] ?? {}).filter((name) => !(name in (before[key] ?? {})));
        expect(added, `${manifest} ${key}: no new dependency`).toEqual([]);
      }
    }

    const out = join(mkdtempSync(join(tmpdir(), "pharn-ci-polset-pins-")), "report.json");
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, CI: "1" };
      delete env.PHARN_TEST_RESULTS;
      const child = spawnSync(
        process.execPath,
        [join(ROOT, "node_modules/vitest/vitest.mjs"), "run", ...RUN, "--reporter=json", `--outputFile=${out}`],
        { cwd: ROOT, env, encoding: "utf8", timeout: 420_000 },
      );
      expect(
        existsSync(out),
        `the child wrote its JSON report (exit ${child.status}): ${child.stderr.slice(-2000)}`,
      ).toBe(true);
      const report = JSON.parse(readFileSync(out, "utf8")) as JsonReport;
      for (const file of RUN) {
        const result = report.testResults.find((r) => r.name.split("\\").join("/").endsWith(file));
        expect(result, `${file} ran`).toBeDefined();
        const failed = (result?.assertionResults ?? []).filter((a) => a.status !== "passed");
        expect(
          failed.map((a) => `${a.title}: ${a.status} ${a.failureMessages.join(" ").slice(0, 500)}`),
          `${file}: every test passed`,
        ).toEqual([]);
        expect(result?.assertionResults.length, `${file}: tests were collected`).toBeGreaterThan(0);
      }
      expect(report.numFailedTests).toBe(0);
      expect(report.numPendingTests + (report.numTodoTests ?? 0), "nothing skipped").toBe(0);
    } finally {
      rmSync(join(out, ".."), { recursive: true, force: true });
    }
  });
});
