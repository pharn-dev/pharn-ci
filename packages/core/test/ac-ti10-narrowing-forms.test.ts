import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-70: TI10 reads a single `|` or `&`, a subshell after `||`, and an added `--exclude` or `--testPathIgnorePatterns`
// as weakenings, and still leaves `&&` lists and an existing pipe alone. check() is loaded inside each test body. The
// diffs are fixtures/test-integrity/TI10/<case>/change.diff (and the existing top-level pass-mocha-timeout.diff), run
// with no test sources so only the diff lines are read.

const REPO_ROOT = "/home/runner/work/demo/demo";
const REPO_FILES = ["package.json", "src/a.ts", "src/a.test.ts"];

type Mode = "block" | "warn";

/** The `"test"` script line of a one-file diff: the removed and added line texts, their values, the added line's head line. */
interface ScriptChange {
  removedLine: string;
  addedLine: string;
  removedValue: string;
  addedValue: string;
  headLine: number;
}

const TEST_VALUE = /"test"\s*:\s*"((?:[^"\\]|\\.)*)"/;

function scriptChange(diff: string): ScriptChange {
  let newLine = 0;
  let removedLine: string | undefined;
  let addedLine: string | undefined;
  let headLine: number | undefined;
  for (const line of diff.split("\n")) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      newLine = Number(header[1]);
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      if (addedLine === undefined && TEST_VALUE.test(line)) {
        addedLine = line.slice(1);
        headLine = newLine;
      }
      newLine += 1;
    } else if (line.startsWith("-")) {
      if (removedLine === undefined && TEST_VALUE.test(line)) removedLine = line.slice(1);
    } else if (line.startsWith(" ")) {
      newLine += 1;
    }
  }
  if (removedLine === undefined || addedLine === undefined || headLine === undefined) {
    throw new Error('the diff holds no removed and added "test" script line');
  }
  return {
    removedLine,
    addedLine,
    removedValue: TEST_VALUE.exec(removedLine)?.[1] ?? "",
    addedValue: TEST_VALUE.exec(addedLine)?.[1] ?? "",
    headLine,
  };
}

async function runDiff(diff: string, mode: Mode) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: REPO_FILES,
    testIntegrityMode: { input: mode },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return {
    signals: report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI10"),
    messages: report.messages.filter((message) => (message.code as string) === "TEST_INTEGRITY_TI10"),
  };
}

describe("CORE-70: TI10 script forms", () => {
  it("AC-9: a single pipe, a single ampersand and a subshell after || each give TI10 at the mode's level with a fixed detail", async () => {
    const cases: Array<[string, string]> = [
      ["block-pipe-tee", "vitest run | tee log"],
      ["block-background-wait", "vitest run & wait"],
      ["block-or-subshell-true", "vitest run || (true)"],
    ];
    for (const [name, added] of cases) {
      const diff = fixture(`test-integrity/TI10/${name}/change.diff`);
      const change = scriptChange(diff);
      expect(change.removedValue, `${name}: removed value`).toBe("vitest run");
      expect(change.addedValue, `${name}: added value`).toBe(added);
      for (const mode of ["block", "warn"] as const) {
        const { signals, messages } = await runDiff(diff, mode);
        expect(signals.length, `${name} (${mode}): at least one TI10`).toBeGreaterThan(0);
        for (const signal of signals) {
          expect(signal.path, `${name} (${mode}): path`).toBe("package.json");
          expect(signal.line, `${name} (${mode}): line`).toBe(change.headLine);
          expect(signal.severity, `${name} (${mode}): severity`).toBe(mode);
        }
        const texts = [...signals.map((signal) => signal.detail), ...messages.map((message) => message.text)];
        const forbidden = [
          '"test"',
          change.removedValue,
          change.addedValue,
          change.removedLine.trim(),
          change.addedLine.trim(),
          "| tee",
          "& wait",
          "(true)",
        ];
        for (const text of texts) {
          for (const piece of forbidden) {
            expect(text.includes(piece), `${name} (${mode}): a TI10 text holds ${JSON.stringify(piece)}`).toBe(false);
          }
        }
      }
    }
  });

  it("AC-10: an added --exclude or --testPathIgnorePatterns gives one block TI10 at the added script line", async () => {
    const cases: Array<[string, string, string]> = [
      ["block-exclude-flag", "vitest run", "vitest run --exclude src/cart"],
      ["block-test-path-ignore-patterns", "jest", "jest --testPathIgnorePatterns=cart"],
    ];
    for (const [name, removed, added] of cases) {
      const diff = fixture(`test-integrity/TI10/${name}/change.diff`);
      const change = scriptChange(diff);
      expect(change.removedValue, `${name}: removed value`).toBe(removed);
      expect(change.addedValue, `${name}: added value`).toBe(added);
      const { signals } = await runDiff(diff, "block");
      expect(signals, `${name}: one TI10`).toHaveLength(1);
      expect(signals[0]?.path, `${name}: path`).toBe("package.json");
      expect(signals[0]?.line, `${name}: line`).toBe(change.headLine);
      expect(signals[0]?.severity, `${name}: severity`).toBe("block");
    }
  });

  it("AC-11: && lists, a mocha timeout and an existing pipe give no TI10", async () => {
    const cases: Array<[string, string, string]> = [
      ["TI10/pass-banner-before-run/change.diff", "vitest", "echo start && vitest run"],
      ["TI10/pass-build-before-run/change.diff", "vitest", "tsc && vitest run"],
      ["TI10/pass-lint-after-run/change.diff", "vitest", "vitest run && eslint ."],
      ["TI10/pass-mocha-timeout.diff", "mocha test/**/*.js", "mocha -t 10000 test/**/*.js"],
      ["TI10/pass-pipe-already-there/change.diff", "vitest run | tee log", "vitest run --reporter=dot | tee log"],
    ];
    for (const [path, removed, added] of cases) {
      const diff = fixture(`test-integrity/${path}`);
      const change = scriptChange(diff);
      expect(change.removedValue, `${path}: removed value`).toBe(removed);
      expect(change.addedValue, `${path}: added value`).toBe(added);
      const { signals } = await runDiff(diff, "block");
      expect(signals, `${path}: no TI10`).toEqual([]);
    }
  });
});
