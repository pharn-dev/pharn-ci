import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { foldCoverageBar, foldLogoPin } from "./helpers.js";
import { withoutFixJson } from "./v090-codes.js";

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
/** CORE-71 (R2.8): the new TI11 flag fixtures and TI13 new-file fixtures, added or untracked until committed. */
const CORE71_FIXTURES =
  /(?:^|\t)fixtures\/test-integrity\/(?:TI11\/(?:pass-(?:pytest-cov-flags|vitest-coverage|jest-ci-coverage|cov-report-value)|block-(?:pytest-path-added|pytest-k-added|pytest-cov-or-true|pass-with-no-tests-added|exclude-added|jest-version-flag|cov-separate-value|coverage-exclude-added|coverage-path-ignore-added|cov-config-added|coverage-false))|TI13\/(?:warn-pragma-new-file|warn-istanbul-next-new-file|block-c8-file-new-file|block-v8-start-new-file))\.diff$/;

// Re-pinned for CORE-70 (TI09 and TI10 narrowing): its new case directories under fixtures/test-integrity/TI09/ and
// fixtures/test-integrity/TI10/ are added (and untracked until committed), by name. `pass-added-vitest-config` is renamed
// to `warn-added-vitest-config` with its files byte-identical, so its two files may show as deleted, and only when the
// `warn-added-vitest-config` copy holds the base's bytes.
const CORE70_TI09 = [
  "warn-added-vitest-config",
  "warn-added-vitest-exclude",
  "warn-added-pytest-testpaths",
  "warn-added-pytest-addopts-path",
  "warn-added-vitest-retry",
  "warn-vitest-not-found-at-base",
  "pass-added-vitest-environment",
  "pass-added-vitest-exclude-node-modules",
  "block-vitest-dir-added",
  "block-vitest-test-name-pattern-added",
  "block-vitest-root-added",
  "block-jest-roots-added",
  "block-jest-module-path-ignore-added",
  "block-pytest-addopts-path-added",
  "block-pytest-addopts-path-removed",
  "block-pytest-addopts-python-functions",
  "pass-jest-roots-widened",
  "pass-jest-roots-default",
  "pass-jest-module-path-ignore-dist",
  "pass-pytest-addopts-verbose",
  "pass-pytest-addopts-path-widened",
  "pass-pytest-addopts-plugin-options",
  "pass-added-vitest-config-defaults",
  "warn-added-vitest-config-defaults-spread",
];
const CORE70_TI10 = [
  "block-pipe-tee",
  "block-background-wait",
  "block-or-subshell-true",
  "block-ampersand-redirect",
  "block-exclude-flag",
  "block-test-path-ignore-patterns",
  "block-pipe-after-and-upload",
  "block-coverage-wrapper-exclude",
  "pass-banner-before-run",
  "pass-build-before-run",
  "pass-lint-after-run",
  "pass-pipe-already-there",
  "pass-redirect-stderr",
  "pass-subshell-after-and",
  "block-one-line-or-true",
  "pass-scripts-reflowed",
  "pass-config-test-key",
  "block-pretest-removed-object",
  "block-or-true-head-dropped",
  "block-newline-true",
  "block-scripts-proto-keys",
  "block-background-run",
  "pass-server-before-run",
];
const CORE70_PATH = new RegExp(
  `^fixtures/test-integrity/(?:TI09/(?:${CORE70_TI09.join("|")})|TI10/(?:${CORE70_TI10.join("|")}))/[^\\t]+$`,
);
// Re-pinned for CORE-50 (binary-diff-not-blind): its new case directories, named one by one, are added too.
const CORE50_PATH = new RegExp(
  `^fixtures/test-integrity/(?:${[
    "TI01/(?:block-binary-gitattributes-deleted|block-binary-spec-mjs-deleted|block-binary-test-cts-deleted|block-binary-py-deleted|block-binary-go-deleted|block-binary-renamed-away|pass-binary-not-test-deleted)",
    "index-unavailable/(?:binary-modified|binary-modified-python|binary-renamed|binary-added|pass-binary-not-test-modified|head-binary-text-diff|base-binary-text-diff|binary-modified-both-dropped)",
    "TI09/(?:block-binary-pass-with-no-tests|pass-binary-same-settings)",
    "TI10/(?:block-binary-no-sources|block-binary-head-dropped|block-binary-or-true-sources|pass-binary-scripts-equal|block-binary-renamed-sources|block-binary-renamed-no-sources)",
    "TI11/(?:block-binary-workflow-modified|block-binary-workflow-deleted|block-binary-workflow-added|block-binary-workflow-renamed|pass-binary-not-workflow)",
    "TI14/(?:block-binary-config-modified|block-binary-config-renamed|block-binary-config-deleted|pass-binary-other-yaml|pass-binary-config-added)",
  ].join("|")})/[^\\t]+$`,
);
// Re-pinned for CORE-53 (the Python index reads how a test is switched off): its new directory
// fixtures/test-integrity/python-switch-off/ (twelve cases and PYTEST-OUTCOMES.md) is added too.
const CORE53_PATH = /^fixtures\/test-integrity\/python-switch-off\/[^\t]+$/;
// Re-pinned for CORE-101 (a backslash in a file name does not hide the file): its new directory
// fixtures/backslash-paths/ (three cases, each an lcov and a Cobertura report, a diff and a tracked-file list) is added.
const CORE101_PATH =
  /^fixtures\/backslash-paths\/(?:literal|windows|both)\/(?:coverage\.info|coverage\.xml|pr\.diff|files\.txt)$/;
// Re-pinned for CORE-92 (a coverage file the PR supplies fails a gated run): its new directory
// fixtures/tracked-coverage/ (one lcov file, the tracked files and four diffs) is added too.
const CORE92_PATH = /^fixtures\/tracked-coverage\/[^/\t]+$/;
// Re-pinned for CORE-124 (message text cannot link issues): its new fixture fixtures/comment-refs/references.txt is
// added too.
const CORE124_PATH = /^fixtures\/comment-refs\/references\.txt$/;

/** The tests the PLAN lists as deliberately updated; each must carry a comment naming this item. */
const DELIBERATE = [
  "packages/action/test/ac-agentpr-action-events.test.ts",
  "packages/action/test/ac-pyparity2-unchanged.test.ts",
  "packages/core/test/ac-precision-v030-schema.test.ts",
  "packages/core/test/ac-secrets-repin.test.ts",
  "packages/core/test/ac-upload-schema.test.ts",
  "packages/core/test/ac-polrules-docs.test.ts",
  // Re-pinned for CORE-133: ac-upload-docs.test.ts left this list. Its re-pin comment sat on the CHANGELOG wording
  // check CORE-133 deleted, so no comment and no re-pinned assertion is left in it.
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
    // Re-pinned for policy rule P14 (agent PR size cap): its new case directories under fixtures/policy-rules/p14/ are
    // added too (and untracked until committed), so both patterns also accept p14; no existing fixture changes.
    for (const line of changed) {
      // Re-pinned for CORE-70: the rename of pass-added-vitest-config to warn-added-vitest-config shows its two files as
      // deleted; each is accepted only when the renamed copy is the base's content byte for byte. Its new case
      // directories are added.
      const renamed =
        /^D\t(fixtures\/test-integrity\/TI09\/)pass-added-vitest-config(\/(?:change\.diff|head\/vitest\.config\.ts\.txt))$/.exec(
          line,
        );
      if (renamed !== null) {
        expect(read(`${renamed[1]}warn-added-vitest-config${renamed[2]}`), line).toBe(
          git("show", `${BASE}:${renamed[1]}pass-added-vitest-config${renamed[2]}`),
        );
        continue;
      }
      if (line.startsWith("A\t") && CORE70_PATH.test(line.slice(2))) continue;
      if (line.startsWith("A\t") && CORE50_PATH.test(line.slice(2))) continue;
      if (line.startsWith("A\t") && CORE53_PATH.test(line.slice(2))) continue;
      if (line.startsWith("A\t") && CORE101_PATH.test(line.slice(2))) continue;
      if (line.startsWith("A\t") && CORE92_PATH.test(line.slice(2))) continue;
      if (line.startsWith("A\t") && CORE124_PATH.test(line.slice(2))) continue;
      // Re-pinned for comment-coverage-bar (the diff-coverage bar in the PR comment): the four golden report.md files
      // gained the bar line on purpose. Each must be modified, never added or deleted, and folding the bar line (and
      // the empty line under it) back out must give its content at the base byte for byte.
      const barred = /^M\t(fixtures\/golden(?:-cobertura|-exclusions|-multi)?\/report\.md)$/.exec(line);
      // Re-pinned for CORE-124: the logo line's raw URL names a commit SHA instead of `main` on purpose. The golden
      // report.md files fold it back before the bar; any other rendered .md modified for that alone must be its content
      // at the base once it is folded back.
      if (barred !== null) {
        expect(foldCoverageBar(foldLogoPin(read(barred[1] as string))), line).toBe(git("show", `${BASE}:${barred[1]}`));
        continue;
      }
      const logoPinned = /^M\t(fixtures\/[^\t]+\.md)$/.exec(line);
      if (logoPinned !== null) {
        expect(foldLogoPin(read(logoPinned[1] as string)), line).toBe(git("show", `${BASE}:${logoPinned[1]}`));
        continue;
      }
      // Re-pinned for fix-hints (H6): the five committed report JSON goldens that carry a message gained a `fix` on
      // each message on purpose. Each must be modified, never added or deleted, and with its `fix` objects taken out it
      // is its content at the base byte for byte.
      const fixed =
        /^M\t(fixtures\/(?:golden|golden-cobertura|golden-multi|coverage-paths\/package-relative)\/report(?:-warn)?\.json)$/.exec(
          line,
        );
      if (fixed !== null) {
        expect(withoutFixJson(read(fixed[1] as string)), line).toBe(git("show", `${BASE}:${fixed[1]}`));
        continue;
      }
      // Re-pinned for ti17-always-true-matcher-2: the two unknown-signal-key policy fixtures name TI18 instead of TI17
      // now that TI17 is a signal. Each must be modified, never added or deleted, and with TI18 turned back into TI17 it
      // is its content at the base byte for byte. Its new case files under fixtures/test-integrity/TI17/ are added too
      // (allowed below), and an existing fixture that changed would still show as modified.
      const unknownTi = /^M\t(fixtures\/policy\/invalid\/unknown-ti\.(?:json|paths))$/.exec(line);
      if (unknownTi !== null) {
        expect(
          read(unknownTi[1] as string)
            .split("TI18")
            .join("TI17"),
          line,
        ).toBe(git("show", `${BASE}:${unknownTi[1]}`));
        continue;
      }
      // Re-pinned for CORE-44 (Enterprise Managed User logins): login-grammar.json listed octo_cat as an invalid login,
      // which is now a valid EMU login, so it lists octo_ca (a 2-character shortcode); with octo_ca turned back into
      // octo_cat it is its content at the base byte for byte. Its new fixtures under fixtures/emu-logins/, the valid
      // policy fixture emu-logins.json and the invalid login-emu-grammar pair are added.
      if (line === "M\tfixtures/policy/invalid/login-grammar.json") {
        expect(read("fixtures/policy/invalid/login-grammar.json").replace('"octo_ca"', '"octo_cat"'), line).toBe(
          git("show", `${BASE}:fixtures/policy/invalid/login-grammar.json`),
        );
        continue;
      }
      if (
        /^A\tfixtures\/(?:emu-logins\/[^/]+|policy\/valid\/emu-logins\.json|policy\/invalid\/login-emu-grammar\.(?:json|paths))$/.test(
          line,
        )
      )
        continue;
      // Re-pinned for markdown-byte-compare (review SPEC finding 29): markdown.test.ts's two snapshots moved, unchanged,
      // into these two new committed files.
      if (/^A\tfixtures\/markdown\/(?:missing|no-coverable)\.md$/.test(line)) continue;
      // Re-pinned for CORE-71 (R2.8): the TI13 new-file fixture that must block carries the whole-file hint now (a
      // line-level hint in a new file is warn); with `file` turned back into `next` it is its content at the base byte
      // for byte. Its new TI11 and TI13 fixture files are added.
      if (line === "M\tfixtures/test-integrity/TI13/block-new-file.diff") {
        expect(
          read("fixtures/test-integrity/TI13/block-new-file.diff").replace("ignore file", "ignore next"),
          line,
        ).toBe(git("show", `${BASE}:fixtures/test-integrity/TI13/block-new-file.diff`));
        continue;
      }
      if (CORE71_FIXTURES.test(line) && line.startsWith("A\t")) continue;
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
      // Re-pinned for policy-p13 (Horizon 2 item H1): its new fixtures under fixtures/policy-rules/p13/ are added too.
      // Re-pinned for A8 step 1 (TESTS_NOT_EXERCISING_CHANGES): its new case directories under fixtures/exercise/ are
      // added too (and untracked until committed).
      // Re-pinned for stale instructions (Horizon 2 item H3): its new fixtures under fixtures/stale-instructions/ are
      // added too.
      expect(line, "a fixture change").toMatch(
        // Re-pinned for H4 (prompt-injection scan): its fixtures under fixtures/injection/ are added too.
        // Re-pinned for flaky tests (A6): its new fixtures under fixtures/junit/ are added too.
        // Re-pinned for dependency safety (A13, v0.8.0): its fixtures under fixtures/dependencies/ are added too.
        // Re-pinned for CORE-39 (job-log escaping): its cases under fixtures/log-escape/ are added too.
        // Re-pinned for CORE-95 (config read at the merge base): its fixtures under fixtures/config-at-merge-base/ too.
        // Re-pinned for CORE-54 (skipIf and runIf no longer excuse TI05 and TI06): its new TI05 and TI06 cases are added too.
        // Re-pinned for CORE-51 (TI01 rename-away and package exemption): its nine new TI01 case directories are added too.
        /^A\tfixtures\/test-integrity\/(?:TI05\/(?:block-pytest-skipif-emptied|block-runif-true-emptied|block-skipif-false-emptied|pass-pytest-skip-emptied|pass-pytest-skipif-unchanged|pass-skipif-unchanged)|TI06\/(?:pass-pytest-skip-weakened|pass-skip-weakened|warn-pytest-skipif-weakened|warn-skipif-weakened))\/[^\t]+$|^A\tfixtures\/junit\/[^/]+$|^A\tfixtures\/stale-instructions\/[^/]+$|^A\tfixtures\/(?:config-at-merge-base|dependencies|exercise|injection|log-escape)\/[^\t]+$|^A\tfixtures\/policy-rules\/(?:p11|p07|p13|p14)\/[^/]+\/[^/]+$|^A\tfixtures\/policy-settings\/[^\t]+$|^A\tfixtures\/test-integrity\/TI03\/[^\t]+$|^A\tfixtures\/test-integrity\/TI17\/[^\t]+$|^A\tfixtures\/test-integrity\/(?:TI10\/(?:block-colon-only|block-true-only|block-true-or-run|pass-true-then-run)|TI14\/block-threshold-(?:emptied|lowered-nbsp-comment|padded-past-cap))\.diff$|^A\tfixtures\/test-integrity\/(?:TI01\/(?:block-test-mts-deleted|block-spec-cts-deleted)|TI04\/block-test-mts-it-only|TI13\/pass-test-mts-istanbul)\/[^\t]+$|^A\tfixtures\/test-integrity\/TI09\/(?:block-opaque-head|block-too-deep-head|pass-added-opaque-config|pass-opaque-base-and-head)\/[^\t]+$|^A\tfixtures\/test-integrity\/(?:index-unavailable\/(?:added-broken|added-parseable|added-python|added-six-broken|mixed|mixed-python)|TI01\/block-same-stem-(?:unparsed|dropped))\/[^\t]+$|^A\tfixtures\/test-integrity\/TI01\/(?:block-package-code-stays|block-package-notes-deleted|block-rename-into-test-dir|block-rename-py-to-txt|info-package-deleted-whole|info-same-stem-code-stays|pass-helper-renamed-in-tests|pass-rename-into-test-dir|pass-rename-test-to-spec)\/(?:change\.diff|files\.txt)$/,
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
      // Re-pinned for CORE-71 (R2.8): so are its new TI11 and TI13 fixture files.
      if (CORE71_FIXTURES.test(path) && path.startsWith("fixtures/")) continue;
      // Re-pinned for CORE-70: its new TI09 and TI10 case directories are untracked until committed.
      if (CORE70_PATH.test(path)) continue;
      // Re-pinned for CORE-50: its new case directories are untracked until committed.
      if (CORE50_PATH.test(path)) continue;
      // Re-pinned for CORE-53: its new python-switch-off directory is untracked until committed.
      if (CORE53_PATH.test(path)) continue;
      // Re-pinned for CORE-101: its new backslash-paths directory is untracked until committed.
      if (CORE101_PATH.test(path)) continue;
      // Re-pinned for CORE-92: its new tracked-coverage directory is untracked until committed.
      if (CORE92_PATH.test(path)) continue;
      // Re-pinned for CORE-124: its new comment-refs fixture is untracked until committed.
      if (CORE124_PATH.test(path)) continue;
      // Re-pinned for policy-p13 (Horizon 2 item H1): its fixtures under fixtures/policy-rules/p13/ are untracked until
      // committed.
      // Re-pinned for stale instructions (Horizon 2 item H3): its fixtures under fixtures/stale-instructions/ are
      // untracked until committed.
      expect(path, "a new fixture").toMatch(
        // Re-pinned for H4 (prompt-injection scan): its fixtures under fixtures/injection/ are untracked until committed.
        // Re-pinned for flaky tests (A6): its fixtures under fixtures/junit/ are untracked until committed.
        // Re-pinned for CORE-39 (job-log escaping): so are its cases under fixtures/log-escape/.
        // Re-pinned for CORE-95 (config read at the merge base): so are its fixtures under fixtures/config-at-merge-base/.
        // Re-pinned for CORE-54 (skipIf and runIf no longer excuse TI05 and TI06): so are its new TI05 and TI06 cases.
        // Re-pinned for CORE-51 (TI01 rename-away and package exemption): so are its nine new TI01 case directories.
        /^fixtures\/test-integrity\/(?:TI05\/(?:block-pytest-skipif-emptied|block-runif-true-emptied|block-skipif-false-emptied|pass-pytest-skip-emptied|pass-pytest-skipif-unchanged|pass-skipif-unchanged)|TI06\/(?:pass-pytest-skip-weakened|pass-skip-weakened|warn-pytest-skipif-weakened|warn-skipif-weakened))\/[^\t]+$|^fixtures\/junit\/[^/]+$|^fixtures\/stale-instructions\/[^/]+$|^fixtures\/(?:config-at-merge-base|dependencies|exercise|injection|log-escape)\/[^\t]+$|^fixtures\/policy-rules\/(?:p11|p07|p13|p14)\/[^/]+\/[^/]+$|^fixtures\/test-integrity\/TI03\/[^\t]+$|^fixtures\/test-integrity\/TI17\/[^\t]+$|^fixtures\/test-integrity\/(?:TI10\/(?:block-colon-only|block-true-only|block-true-or-run|pass-true-then-run)|TI14\/block-threshold-(?:emptied|lowered-nbsp-comment|padded-past-cap))\.diff$|^fixtures\/policy-settings\/unparseable\/[^\t]+$|^fixtures\/test-integrity\/(?:TI01\/(?:block-test-mts-deleted|block-spec-cts-deleted)|TI04\/block-test-mts-it-only|TI13\/pass-test-mts-istanbul)\/[^\t]+$|^fixtures\/test-integrity\/TI09\/(?:block-opaque-head|block-too-deep-head|pass-added-opaque-config|pass-opaque-base-and-head)\/[^\t]+$|^fixtures\/test-integrity\/(?:index-unavailable\/(?:added-broken|added-parseable|added-python|added-six-broken|mixed|mixed-python)|TI01\/block-same-stem-(?:unparsed|dropped))\/[^\t]+$|^fixtures\/test-integrity\/TI01\/(?:block-package-code-stays|block-package-notes-deleted|block-rename-into-test-dir|block-rename-py-to-txt|info-package-deleted-whole|info-same-stem-code-stays|pass-helper-renamed-in-tests|pass-rename-into-test-dir|pass-rename-test-to-spec)\/(?:change\.diff|files\.txt)$/,
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
