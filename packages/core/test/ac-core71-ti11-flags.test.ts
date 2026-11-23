import { describe, expect, it } from "vitest";
import { runDiff, runFixture, signalsOf } from "./ac-e1-fix-shared.js";
import { measureGrowth } from "./growth.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-71 (R2.8): a test command that gains only report or verbosity flags is still the same test step. check() is
// loaded inside each test body (through runDiff), so nothing the change adds runs while the file loads.

const CI = ".github/workflows/ci.yml";
const TEST_STEP = "A step that runs tests was removed from a workflow.";
type Mode = "block" | "warn";

/** A modified workflow whose line 14 changes from `from` to `to` (`to` null: the line is removed). */
function change(from: string, to: string | null): string {
  const head = [`diff --git a/${CI} b/${CI}`, "index 1111111..2222222 100644", `--- a/${CI}`, `+++ b/${CI}`];
  const body =
    to === null
      ? ["@@ -14 +13,0 @@", `-      - run: ${from}`]
      : ["@@ -14 +14 @@", `-      - run: ${from}`, `+      - run: ${to}`];
  return `${[...head, ...body].join("\n")}\n`;
}

const ti11 = async (diff: string, mode: Mode) =>
  signalsOf(await runDiff(diff, mode), "TI11").map((s) => ({ severity: s.severity, line: s.line, detail: s.detail }));
const fixtureTi11 = async (name: string, mode: Mode) =>
  signalsOf(await runFixture(`TI11/${name}`, mode), "TI11").map((s) => ({ severity: s.severity, detail: s.detail }));

/** Edits that only add report or verbosity flags: no TI11 in either mode. */
const KEPT: Array<[string, string]> = [
  ["pytest", "pytest --cov=src --cov-report=xml"],
  ["vitest run", "vitest run --coverage"],
  ["jest", "jest --ci --coverage"],
  ["npx vitest run", "pnpm exec vitest run --coverage --reporter=junit"],
  ["pnpm test", "pnpm test -- --coverage"],
  ["go test ./...", "go test -v ./..."],
  ["pytest", "pytest -q -v"],
  ["python -m pytest tests", "python -m pytest --cov=src --cov-report xml --junitxml junit.xml tests"],
  ["pytest --cov=src", "pytest --cov=src --cov-report=term-missing"],
  ["pnpm build && vitest run", "pnpm build && vitest run --coverage.enabled=true"],
  ["uv run pytest -q", "uv run pytest -q --cov=pkg"],
  [
    "vitest run",
    "vitest run --coverage=true --coverage.enabled --coverage.provider=v8 --coverage.reportsDirectory=out",
  ],
  [
    "jest",
    "jest --coverage --coverageReporters=lcov --coverageProvider=v8 --coverageDirectory=out --reporters=default",
  ],
  ["pytest", "pytest --cov --cov-branch --cov-report=lcov:out/lcov.info"],
];

/**
 * Flags that narrow what coverage measures or turn it off: not report flags, so adding one is a lost step (the review
 * of CORE-71: a pull request must not take its own files out of the coverage file without a finding).
 */
const NARROWING: Array<[string, string]> = [
  ["vitest run", "vitest run --coverage --coverage.exclude=src/billing/**"],
  ["vitest run", "vitest run --coverage --coverage.exclude=src/billing"],
  ["vitest run", "vitest run --coverage --coverage.include=src/core"],
  ["vitest run", "vitest run --coverage=false"],
  ["vitest run", "vitest run --coverage.enabled=false"],
  ["vitest run", "vitest run --coverage --coverage.thresholds.lines=0"],
  ["jest", "jest --coverage --coveragePathIgnorePatterns=src/billing"],
  ["jest", "jest --coverage --collectCoverageFrom=src/core/index.ts"],
  ["jest", "jest --coverage --coverageThreshold={}"],
  ["pytest", "pytest --cov=src --cov-config=.cov.ini"],
  ["pytest", "pytest --cov=src --cov-fail-under=0"],
  ["pytest", "pytest --no-cov"],
  ["pytest", "pytest --cov="],
  ["jest", "jest --reporter="],
];

/** Edits that add anything else, drop a flag or remove the step: one TI11 test-step signal at the mode's level. */
const LOST: Array<[string, string | null]> = [
  ["pytest", "pytest tests/unit"],
  ["pytest", "pytest -k smoke"],
  ["pytest", "pytest --cov=src || true"],
  ["pytest", "pytest --cov=src||true"],
  ["pytest", null],
  ["jest", "jest --ci --passWithNoTests"],
  ["vitest run", "vitest run --coverage --exclude src/billing"],
  ["vitest run", "vitest run --coverage src/billing"],
  ["pytest", "pytest --cov src"],
  ["pytest --cov=src", "pytest"],
  ["jest", "jest -v"],
  ["vitest run", "vitest run -q"],
  ["pnpm test", "pnpm test -v"],
  ["pytest", "pytest --cov=$SRC"],
  ["pytest", "pytest --junitxml $OUT"],
];

describe("TI11: a test command that gains report flags is the same step (CORE-71)", () => {
  it("must not trigger: a command that gains only listed flags (and the value of a flag that takes one) gives no TI11", async () => {
    for (const mode of ["block", "warn"] as const) {
      for (const [from, to] of KEPT) {
        expect(await ti11(change(from, to), mode), `${mode}: ${from} → ${to}`).toEqual([]);
      }
    }
  }, 120_000);

  it("must trigger: a path, -k, || true, an unlisted flag, a separate value of a flag that takes none, a dropped flag or a removed step is a lost step at the mode's level", async () => {
    for (const mode of ["block", "warn"] as const) {
      for (const [from, to] of LOST) {
        expect(await ti11(change(from, to), mode), `${mode}: ${from} → ${to ?? "(removed)"}`).toEqual([
          { severity: mode, line: 14, detail: TEST_STEP },
        ]);
      }
    }
  }, 120_000);

  it("must trigger: a flag that narrows what coverage measures or turns it off is not a report flag", async () => {
    for (const mode of ["block", "warn"] as const) {
      for (const [from, to] of NARROWING) {
        expect(await ti11(change(from, to), mode), `${mode}: ${from} → ${to}`).toEqual([
          { severity: mode, line: 14, detail: TEST_STEP },
        ]);
      }
    }
  }, 120_000);

  it("the fixtures: the pass- ones give no TI11, the block- ones give one test-step signal at the mode's level", async () => {
    const pass = [
      "pass-pytest-cov-flags.diff",
      "pass-vitest-coverage.diff",
      "pass-jest-ci-coverage.diff",
      "pass-cov-report-value.diff",
    ];
    const block = [
      "block-pytest-path-added.diff",
      "block-pytest-k-added.diff",
      "block-pytest-cov-or-true.diff",
      "block-pass-with-no-tests-added.diff",
      "block-exclude-added.diff",
      "block-jest-version-flag.diff",
      "block-cov-separate-value.diff",
      "block-coverage-exclude-added.diff",
      "block-coverage-path-ignore-added.diff",
      "block-cov-config-added.diff",
      "block-coverage-false.diff",
    ];
    for (const mode of ["block", "warn"] as const) {
      for (const name of pass) expect(await fixtureTi11(name, mode), `${mode}: ${name}`).toEqual([]);
      for (const name of block) {
        expect(await fixtureTi11(name, mode), `${mode}: ${name}`).toEqual([{ severity: mode, detail: TEST_STEP }]);
      }
    }
  }, 120_000);

  it("the comparison stays linear when many added commands share a base with different flags", async () => {
    const { check } = await import("./text-coverage.js");
    type Input = Parameters<typeof check>[0];
    // n removed `pytest --cov-report=rK` lines and n added `pytest --cov=aK` lines: every key has the base `pytest`,
    // and no added key carries a removed key's flag, so every removed key is compared with added candidates.
    const diffFor = (n: number) => {
      const removed: string[] = [];
      const added: string[] = [];
      for (let k = 0; k < n; k++) {
        removed.push(`-      - run: pytest --cov-report=r${k}`);
        added.push(`+      - run: pytest --cov=a${k}`);
      }
      const head = [`diff --git a/${CI} b/${CI}`, "index 1111111..2222222 100644", `--- a/${CI}`, `+++ b/${CI}`];
      return `${[...head, `@@ -10,${n} +10,${n} @@`, ...removed, ...added].join("\n")}\n`;
    };
    const inputFor = (n: number) =>
      ({
        version: "0.1.0",
        coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
        diff: { text: diffFor(n) },
        repoRoot: "/home/runner/work/demo/demo",
        threshold: 80,
        repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
        testIntegrityMode: { input: "block" },
      }) as unknown as Input;
    const small = inputFor(2000);
    const large = inputFor(8000);
    for (const input of [small, large]) {
      const report = check(input);
      expectValidReport(report);
      const signals = report.testIntegrity.signals.filter((s) => String(s.id) === "TI11");
      expect(signals).toEqual([expect.objectContaining({ severity: "block", line: 10, detail: TEST_STEP })]);
    }
    const growth = await measureGrowth(
      () => check(small),
      () => check(large),
    );
    expect(growth.ratio, `8000 vs 2000 commands: ${growth.detail}`).toBeLessThan(8);
  }, 300_000);
});
