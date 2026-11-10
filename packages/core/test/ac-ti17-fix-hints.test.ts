import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// ti17-always-true-matcher-2, AC-18. check(), withFixHints() and the fix tables are loaded inside the test body: the
// AC test is written before TI17 exists. The report is the one of AC-1 (the vitest Skylos case always-true-matcher).

const REPO_ROOT = "/home/runner/work/demo/demo";
const CASE = "skylos-nine/always-true-matcher";
const ID = ["TI", "17"].join("");
const CODE = ["TEST_INTEGRITY_", ID].join("");
const KINDS = [
  "add-test",
  "restore-test",
  "restore-assertion",
  "revert-config",
  "remove-dependency",
  "request-review",
  "split-pr",
  "none",
];

type Fix = { kind: string; hint: string; target?: string };
type Entry = { kind: string; hint: string };

/** One sentence: a non-empty text with exactly one sentence end, at its end. */
function expectOneSentence(hint: string, label: string): void {
  const text = hint.trim();
  expect(text.length, `${label}: not empty`).toBeGreaterThan(0);
  expect(hint.length, `${label}: at most 200 characters`).toBeLessThanOrEqual(200);
  expect(text.match(/[.!?](\s|$)/g) ?? [], `${label}: one sentence`).toHaveLength(1);
  expect(/[.!?]$/.test(text), `${label}: ends the sentence`).toBe(true);
}

describe("fix hints for TI17", () => {
  it("AC-18: the TI17 signal and the TEST_INTEGRITY_TI17 message each carry a restore-assertion fix with one fixed sentence of at most 200 characters, the signal's target is its path:line, and the fix kinds are the same eight", async () => {
    const { check } = await import("../src/check.js");
    const core = (await import("../src/index.js")) as unknown as {
      withFixHints(report: unknown): unknown;
      FIX_KINDS: readonly string[];
      SIGNAL_FIXES: Record<string, Entry>;
      MESSAGE_FIXES: Record<string, Entry>;
    };
    const raw = check({
      version: "0.1.0",
      coverage: { text: "SF:src/cart.ts\nDA:1,1\nend_of_record\n", format: "lcov" },
      diff: { text: fixture(`${CASE}/change.diff`) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture(`${CASE}/files.txt`).trim().split("\n"),
      testIntegrityMode: { input: "block" },
    } as Parameters<typeof check>[0]);
    const report = core.withFixHints(raw) as typeof raw;
    expectValidReport(report);

    const signals = report.testIntegrity.signals.filter((s) => String(s.id) === ID);
    expect(signals).toHaveLength(1);
    const signalFix = (signals[0] as unknown as { fix?: Fix }).fix;
    expect(signalFix?.kind).toBe("restore-assertion");
    expectOneSentence(signalFix?.hint ?? "", "signal hint");
    expect(signalFix?.target).toBe("src/cart.test.ts:9");

    const messages = report.messages.filter((m) => String(m.code) === CODE);
    expect(messages).toHaveLength(1);
    const messageFix = (messages[0] as unknown as { fix?: Fix }).fix;
    expect(messageFix?.kind).toBe("restore-assertion");
    expectOneSentence(messageFix?.hint ?? "", "message hint");

    expect(core.SIGNAL_FIXES[ID]?.kind).toBe("restore-assertion");
    expect(core.MESSAGE_FIXES[CODE]?.kind).toBe("restore-assertion");
    expect(signalFix?.hint).toBe(core.SIGNAL_FIXES[ID]?.hint);
    expect([...core.FIX_KINDS]).toEqual(KINDS);
  });
});
