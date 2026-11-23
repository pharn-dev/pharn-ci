import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import type { TestSourceFile as SourceFile, TestSources } from "../src/testSources.js";
import { withCore95Ti14Before } from "./core95-ti14.js";
import { exerciseMessages, withoutExerciseCheck } from "./exercise-repin.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import type { TextCheckInput } from "./text-coverage.js";
import { withoutFix } from "./v090-codes.js";

// check() and the core entry point are loaded inside each test body: the AC tests are written before TI06 and TI12
// exist, so nothing that depends on them may run while the file loads.
//
// What stays: every golden report, with and without sources; every earlier diff-only signal fixture gives the signals
// and messages it gave before (the digest ac-ti0205-regression.test.ts pins); and every TI02 and TI05 case, with its
// base and head text, gives the signals and messages it gave at the base commit 98693cf (a digest taken there), so none
// gains a TI06 or TI12. (CORE-132: the second AC-19 test, which compared the six Skylos test files' titles with an old
// commit and checked literals in those files, was a history pin and is removed.)

const REPO_ROOT = "/home/runner/work/demo/demo";
const EARLIER_DIRS = ["TI01", "TI03", "TI04", "TI10", "TI11", "TI13", "TI14"];
/** Fixtures the 2026-11-01 review fixes add (TI10 no-op script, TI14 comment rule); left out of the digest. */
const REVIEW_1101_ADDED: ReadonlySet<string> = new Set([
  "TI10/block-colon-only.diff",
  "TI10/block-true-only.diff",
  "TI10/block-true-or-run.diff",
  "TI10/pass-true-then-run.diff",
  "TI14/block-threshold-emptied.diff",
  "TI14/block-threshold-lowered-nbsp-comment.diff",
  "TI14/block-threshold-padded-past-cap.diff",
]);
const PAIR_DIRS = ["TI02", "TI05"];
/** The TI11 fixtures the signal-precision increment adds; the digest below predates them, so the loop leaves them out. */
const NEW_TI11 = new Set([
  "pass-package-manager-swap.diff",
  "block-job-moved-with-tests.diff",
  "block-swap-drops-test.diff",
  "block-job-removed-script-kept.diff",
]);
/** CORE-71 (R2.8): the TI11 and TI13 fixtures it adds; the digest below predates them, so the loop leaves them out. */
const CORE71_ADDED: ReadonlySet<string> = new Set([
  "TI11/pass-pytest-cov-flags.diff",
  "TI11/pass-vitest-coverage.diff",
  "TI11/pass-jest-ci-coverage.diff",
  "TI11/pass-cov-report-value.diff",
  "TI11/block-pytest-path-added.diff",
  "TI11/block-pytest-k-added.diff",
  "TI11/block-pytest-cov-or-true.diff",
  "TI11/block-pass-with-no-tests-added.diff",
  "TI11/block-exclude-added.diff",
  "TI11/block-jest-version-flag.diff",
  "TI11/block-cov-separate-value.diff",
  "TI11/block-coverage-exclude-added.diff",
  "TI11/block-coverage-path-ignore-added.diff",
  "TI11/block-cov-config-added.diff",
  "TI11/block-coverage-false.diff",
  "TI13/warn-pragma-new-file.diff",
  "TI13/warn-istanbul-next-new-file.diff",
  "TI13/block-c8-file-new-file.diff",
  "TI13/block-v8-start-new-file.diff",
]);
/**
 * The TI02 and TI05 case directories added after the base commit (the Python alias cases of py-parity-2). They need the
 * Python index, which this file runs without, and the digest below never covered them; the node-io tests run them.
 */
const ADDED_AFTER_BASE: ReadonlySet<string> = new Set([
  "TI02/block-pytest-alias-marked-removed",
  "TI02/block-pytest-alias-marked-removed-literal",
  "TI02/pass-pytest-alias-fixture-removed",
  "TI02/pass-pytest-alias-fixture-removed-literal",
  "TI05/block-pytest-alias-raises-removed",
  "TI05/block-pytest-alias-raises-removed-literal",
  "TI05/pass-pytest-alias-emptied-skipped",
  "TI05/pass-pytest-alias-emptied-skipped-literal",
  // CORE-54 (skipIf and runIf no longer excuse TI05 and TI06) adds these cases after the base; the digest below never
  // covered them, and ac-ti0506-conditional-skip and ac-ti0506-python-conditional-skip assert them.
  "TI05/block-pytest-skipif-emptied",
  "TI05/block-runif-true-emptied",
  "TI05/block-skipif-false-emptied",
  "TI05/pass-pytest-skip-emptied",
  "TI05/pass-pytest-skipif-unchanged",
  "TI05/pass-skipif-unchanged",
]);
/** The digest ac-ti0205-regression.test.ts pins for the earlier fixtures without sources. */
// Re-pinned by the name-only-moves change, with ac-ti0205-regression.test.ts: the two TI01 migration records changed.
const EARLIER_DIGEST = "0197e0cfe0e50e9dfc8c453e5bfa978147632c47ab09dfc073d770cd965bb04f";
// ti03-skip-evasion (review B1) rewords the one TI03 sentence for a skip the diff shows as new. The earlier records put
// the earlier sentence back before they are hashed, so EARLIER_DIGEST still pins every other byte of the outputs.
const TI03_ADDS_NOW =
  "A skip was added to a test that no removed line of this file opens, so the diff shows it as new.";
const TI03_ADDS_BEFORE = "A skip was added to a test that this change adds, so no test that ran before stops running.";
const asBefore = (json: string) => json.split(TI03_ADDS_NOW).join(TI03_ADDS_BEFORE);
/**
 * sha256 of the JSON list of { fixture, signals, messages } over the TI02 and TI05 cases with their sources, in
 * directory then case order, as check() gave them at the base commit 98693cf.
 */
// Re-pinned by the name-only-moves change: only TI02/pass-moved-to-other-file changed (it now gives one TI02 block),
// because TI02's phase-2 leaf pick now needs body evidence, not a name alone.
const PAIR_DIGEST = "129d9dbe605feab5c7cd65df323ee57ca43e4cb19a1142f99402c8048073d867";
const NEW_IDS = ["TI06", "TI12"];
const NEW_CODES = ["TEST_INTEGRITY_TI06", "TEST_INTEGRITY_TI12"];

const asFile = (report: unknown) => `${JSON.stringify(report, null, 2)}\n`;
const fixtureLines = (path: string) => fixture(path).trim().split("\n");

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

/** The exclusion patterns the TI14 fixture that appends an item is judged against: the items it appends. */
function excludeFor(name: string, text: string): string[] {
  if (name !== "TI14/block-exclude-appended.diff") return [];
  return text
    .split("\n")
    .filter((line) => /^\+\s+- /.test(line))
    .map((line) => line.replace(/^\+\s+- /, "").replace(/^["']|["']$/g, ""));
}

function expectNoNewSignal(report: Report, label: string): void {
  expect(
    report.testIntegrity.signals.filter((s) => NEW_IDS.includes(String(s.id))),
    `${label}: no TI06 or TI12`,
  ).toEqual([]);
  expect(
    report.messages.filter((m) => NEW_CODES.includes(String(m.code))),
    `${label}: no TEST_INTEGRITY_TI06 or TEST_INTEGRITY_TI12 message`,
  ).toEqual([]);
}

describe("TI06 and TI12 change the earlier outputs and tests only where they mean to", () => {
  it("AC-19: the goldens stay byte-identical, the earlier diff-only fixtures and the TI02 and TI05 cases with their sources give what they gave before, and none of them gives a TI06 or TI12", async () => {
    const core = {
      ...(await import("../src/signals/ti06.js")),
      ...(await import("../src/signals/ti12.js")),
    } as unknown as Record<string, unknown>;
    expect(typeof core.detectTI06, "TI06 exists, so its absence below is the inputs' doing").toBe("function");
    expect(typeof core.detectTI12, "TI12 exists, so its absence below is the inputs' doing").toBe("function");
    const { check } = await import("./text-coverage.js");
    const { parseConfig } = await import("../src/config.js");

    // The goldens, built as the test that owns each report.json builds them.
    const exclusionsConfig = parseConfig(fixture("golden-exclusions/ci.yml")) as {
      coverage?: { exclude?: string[]; threshold?: number };
    };
    const golden = (dir: string) => ({
      version: "0.1.0",
      diff: { text: fixture(`${dir}/pr.diff`) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixtureLines(`${dir}/files.txt`),
    });
    const sets: Array<[string, TextCheckInput]> = [
      ["golden", { ...golden("golden"), coverage: { text: fixture("golden/coverage.info"), format: "lcov" } }],
      [
        "golden-cobertura",
        { ...golden("golden-cobertura"), coverage: { text: fixture("golden-cobertura/coverage.xml"), format: "auto" } },
      ],
      [
        "golden-exclusions",
        {
          ...golden("golden-exclusions"),
          coverage: { text: fixture("golden-exclusions/coverage.info"), format: "lcov" },
          threshold: exclusionsConfig.coverage?.threshold ?? null,
          exclude: exclusionsConfig.coverage?.exclude ?? [],
        },
      ],
      [
        "golden-multi",
        {
          ...golden("golden-multi"),
          coverage: {
            files: [
              { text: fixture("golden-multi/coverage-a.info"), file: "coverage/a/lcov.info" },
              { text: fixture("golden-multi/coverage-b.info"), file: "coverage/b/lcov.info" },
            ],
            format: "auto",
          },
        },
      ],
    ];
    const withText: TestSources = {
      base: { files: [{ path: "a.test.ts", text: 'it("a", () => { expect(1).toBe(1); });\n' }], dropped: [] },
      head: { files: [], dropped: [{ path: "c.test.ts", reason: "binary" }] },
    };
    for (const [dir, input] of sets) {
      const committed = fixture(`${dir}/report.json`);
      for (const [label, extra] of [
        ["without sources", {}],
        ["with sources", { testSources: withText }],
      ] as const) {
        const report = check({ ...input, ...extra });
        expectValidReport(report);
        // Re-pinned for A8 step 1 (exercise-repin.ts): with sources the tests-exercise check may add its one warn
        // message and testIntegrity.exercise; with those taken out the report is the golden byte for byte.
        if (label === "without sources") expect(exerciseMessages(report), `${dir} ${label}`).toEqual([]);
        expect(asFile(withoutExerciseCheck(report)), `${dir} ${label}: the committed report.json`).toBe(committed);
      }
    }

    // The earlier diff-only fixtures, without sources.
    const earlier: Array<{ fixture: string; signals: unknown[]; messages: unknown[] }> = [];
    for (const dir of EARLIER_DIRS) {
      const names = readdirSync(`${FIXTURES}test-integrity/${dir}`)
        .filter(
          (name) =>
            name.endsWith(".diff") &&
            !(dir === "TI11" && NEW_TI11.has(name)) &&
            !REVIEW_1101_ADDED.has(`${dir}/${name}`) &&
            !CORE71_ADDED.has(`${dir}/${name}`),
        )
        .sort();
      for (const file of names) {
        const name = `${dir}/${file}`;
        const text = fixture(`test-integrity/${name}`);
        const files = `test-integrity/${name.replace(/\.diff$/, ".files.txt")}`;
        const report = check({
          version: "0.1.0",
          coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
          diff: { text },
          repoRoot: REPO_ROOT,
          threshold: 80,
          repoFiles: fixtureLines(existsSync(`${FIXTURES}${files}`) ? files : "test-files-deleted/files.txt"),
          exclude: excludeFor(name, text),
          testIntegrityMode: { input: "block" },
        });
        expectValidReport(report);
        expectNoNewSignal(report, name);
        if (name === "TI01/pass-binary.diff") {
          // CORE-50 (binary-diff-not-blind): this fixture (a deleted binary tests/img.test.ts) now gives one TI01 block,
          // where the base commit gave nothing. Assert that new record, then take it out, so EARLIER_DIGEST still pins
          // the base record of this fixture and every other one.
          const ti01 = report.testIntegrity.signals.filter((s) => (s as { id: string }).id === "TI01");
          expect(ti01.map((s) => (s as { path: string }).path)).toEqual(["tests/img.test.ts"]);
          expect(report.messages.filter((m) => m.code === "TEST_INTEGRITY_TI01")).toHaveLength(1);
          earlier.push({
            fixture: name,
            signals: report.testIntegrity.signals.filter((s) => (s as { id: string }).id !== "TI01"),
            messages: report.messages.filter((m) => m.code !== "TEST_INTEGRITY_TI01"),
          });
        } else {
          earlier.push({ fixture: name, signals: report.testIntegrity.signals, messages: report.messages });
        }
      }
    }
    expect(earlier.length).toBeGreaterThan(100);
    // fix-hints (H6): the signals and messages now carry a `fix`; it is taken out, so the digests still pin the base outputs.
    expect(
      createHash("sha256")
        // Re-pinned for CORE-95: the reworded TI14 sentence is put back first (core95-ti14.ts).
        .update(withCore95Ti14Before(asBefore(JSON.stringify(withoutFix(earlier)))))
        .digest("hex"),
      "the earlier fixtures without sources give what they gave before",
    ).toBe(EARLIER_DIGEST);

    // The TI02 and TI05 cases, with their base and head text.
    const pairs: Array<{ fixture: string; signals: unknown[]; messages: unknown[] }> = [];
    for (const dir of PAIR_DIRS) {
      const names = readdirSync(`${FIXTURES}test-integrity/${dir}`, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !ADDED_AFTER_BASE.has(`${dir}/${entry.name}`))
        .map((entry) => entry.name)
        .sort();
      for (const name of names) {
        const root = `${FIXTURES}test-integrity/${dir}/${name}/`;
        const base = sideFiles(`${root}base`);
        const head = sideFiles(`${root}head`);
        const diff = readFileSync(`${root}change.diff`, "utf8");
        const report = check({
          version: "0.1.0",
          coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
          diff: { text: diff },
          repoRoot: REPO_ROOT,
          threshold: 80,
          repoFiles: [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
          testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
          testIntegrityMode: { input: "block" },
        });
        expectValidReport(report);
        expectNoNewSignal(report, `${dir}/${name}`);
        // Re-pinned for A8 step 1 (exercise-repin.ts): a case whose change edits a source file no changed test imports
        // also gets the tests-exercise warn message; it is taken out before hashing, so PAIR_DIGEST is unchanged.
        expect(exerciseMessages(report).length, `${dir}/${name}`).toBeLessThanOrEqual(1);
        pairs.push({
          fixture: `${dir}/${name}`,
          signals: report.testIntegrity.signals,
          messages: withoutExerciseCheck(report).messages,
        });
      }
    }
    expect(pairs.length).toBeGreaterThan(30);
    expect(
      createHash("sha256")
        .update(JSON.stringify(withoutFix(pairs)))
        .digest("hex"),
      "the TI02 and TI05 cases give what they gave at the base commit",
    ).toBe(PAIR_DIGEST);
  }, 60_000);
});
