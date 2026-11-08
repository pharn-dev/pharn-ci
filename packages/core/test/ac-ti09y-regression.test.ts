import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The files are read inside the test body: the AC test is written before the deliberate Skylos-count updates. The two
// regression tests are pinned by the sha256 they have on main at e47695e (this change was rebased onto it after TI06,
// TI07, TI08, TI12, TI15 and TI16 shipped; the accept-label test's fixture list changed there, not here), so a change
// to either one fails here; the Skylos-count tests are read as text for the move of deselect-setting to caught by TI09,
// which takes the count from 6 of 9 on that main to 7 of 9.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIST_BOUND = 12_000_000;

/**
 * The two regression tests and their sha256. Re-pinned by the signal-precision increment: it edits both on purpose (the
 * new TI11 fixtures left out of the base-commit digest loop; the new TI11 and TI15 fixtures added to ADDED_AFTER_BASE),
 * so these are the digests of the edited files; before that they were on main at e47695e.
 */
// Re-pinned again by the name-only-moves change: both files are edited on purpose (a re-pinned digest and a comment
// each), so these are the digests of those edited files.
// Re-pinned again by ti03-skip-evasion (review B1): both files put the earlier TI03 sentence for a skip the diff shows
// as new back into their records before hashing, so their output digests are unchanged; these are the edited files.
// Re-pinned again by the 2026-11-01 review fixes: both files leave the review's new TI10 and TI14 fixtures out
// of their loops (their output digests are unchanged); these are the edited files.
// Re-pinned again by block-fails-closed-unavailable (review HIGH 4): ac-ti0205-regression is edited on purpose (a
// whole-run unavailable message is an error in block, was a warn), so this is the digest of the edited file.
// Re-pinned again by comment-coverage-bar: ac-accept-signoff-regression folds the new diff-coverage bar line out of
// fixtures/golden/report.md before hashing it (its golden digest is unchanged); this is the digest of the edited file.
// Re-pinned again by A8 step 1 (TESTS_NOT_EXERCISING_CHANGES): ac-ti0205-regression takes the tests-exercise message
// and testIntegrity.exercise out of the golden reports made with sources before comparing (exercise-repin.ts); this is
// the digest of the edited file.
const PINNED: Record<string, string> = {
  "packages/core/test/ac-ti0205-regression.test.ts": "fc539d32fd9fd3f12dea5f0883d2c6d0f6dd3307d9bde6603ca2433675a08aff",
  "packages/action/test/ac-accept-signoff-regression.test.ts":
    "cf611d3c9bb955ec82b2acf8dab562e77921d012f653a61067fc0c34e4806eef",
};

/** The Skylos-count tests that record the move, and the count literal each one asserts. */
const COUNT_TESTS: Record<string, string> = {
  "packages/core/test/ac-skylos-nine-table.test.ts": '"7/9"',
  "packages/core/test/ac-v020-skylos-count.test.ts": '"7 of 9"',
  "packages/core/test/ac-v020-limits.test.ts": '"7 of 9"',
  "packages/core/test/ac-v020-readme.test.ts": '"7 of 9"',
  "packages/core/test/ac-ti0205-skylos.test.ts": '"7 of 9"',
};
const MISSES_TEST = "packages/core/test/ac-skylos-nine-misses.test.ts";

const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const sha256 = (path: string) =>
  createHash("sha256")
    .update(readFileSync(`${ROOT}${path}`))
    .digest("hex");

describe("TI09: the existing suite is unchanged apart from the deliberate Skylos-count move", () => {
  it("AC-20: the Skylos-count tests record deselect-setting caught by TI09 and 7 of 9, the TI02/TI05 and accept-label regression tests are byte-identical to main, and the Action dist stays under 12 MB", () => {
    for (const [path, literal] of Object.entries(COUNT_TESTS)) {
      const text = read(path);
      expect(text, `${path} asserts ${literal}`).toContain(literal);
      expect(text, `${path} no longer asserts "4 of 9"`).not.toContain('"4 of 9"');
      expect(text, `${path} no longer asserts "4/9"`).not.toContain('"4/9"');
    }
    expect(
      read("packages/core/test/ac-skylos-nine-table.test.ts"),
      "the table marks deselect-setting caught",
    ).toContain('{ name: "deselect-setting", signal: "TI09", caught: true }');
    expect(read("packages/core/test/ac-ti0205-skylos.test.ts"), "CAUGHT maps deselect-setting to TI09").toContain(
      '["deselect-setting", "TI09"]',
    );
    const misses = read(MISSES_TEST).split("\n");
    expect(
      misses.some((line) => line.trim() === '"deselect-setting",'),
      "deselect-setting is no longer an entry of MISSES",
    ).toBe(false);

    for (const [path, digest] of Object.entries(PINNED)) {
      expect(sha256(path), `${path} is byte-identical to the base commit`).toBe(digest);
    }

    const size = statSync(`${ROOT}packages/action/dist/index.js`).size;
    expect(size, "the Action dist stays within its 12 MB bound").toBeLessThan(DIST_BOUND);
  });
});
