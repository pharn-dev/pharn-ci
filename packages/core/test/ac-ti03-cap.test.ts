import { describe, expect, it } from "vitest";
import { messagesOf, runFixture, signalsOf } from "./ac-e1-fix-shared.js";

// TI03 gives at most 20 signals per file. The unconditional skips of existing tests are kept first, so warn findings
// placed above a block can never push it out of the report.

describe("TI03: the per-file cap keeps the block findings", () => {
  it("twenty conditional skips above one unconditional skip of an existing test: the block is kept and the check fails", async () => {
    const report = await runFixture("TI03/block-behind-twenty-warns.diff");
    const signals = signalsOf(report, "TI03");
    expect(signals).toHaveLength(20);
    expect(signals.filter((s) => s.severity === "block")).toEqual([
      expect.objectContaining({ path: "src/user.test.ts", line: 60, severity: "block" }),
    ]);
    expect(signals.filter((s) => s.severity === "warn")).toHaveLength(19);
    // The report stays in line order.
    expect(signals.map((s) => s.line)).toEqual([...signals.map((s) => s.line)].sort((a, b) => (a ?? 0) - (b ?? 0)));
    expect(messagesOf(report, "TEST_INTEGRITY_TI03")[0]?.level).toBe("error");
    expect(report.testIntegrity.verdict).toBe("fail");
    expect(report.verdict).toBe("fail");
  });

  it("the same diff in mode warn keeps the skip of the existing test too, as a warn", async () => {
    const signals = signalsOf(await runFixture("TI03/block-behind-twenty-warns.diff", "warn"), "TI03");
    expect(signals).toHaveLength(20);
    expect(signals.some((s) => s.line === 60)).toBe(true);
    expect(signals.every((s) => s.severity === "warn")).toBe(true);
  });

  it("twenty-five conditional skips and no block: the cap keeps the first twenty by line, all warn", async () => {
    const report = await runFixture("TI03/warn-twenty-five-conditional.diff");
    const signals = signalsOf(report, "TI03");
    expect(signals.map((s) => s.line)).toEqual(Array.from({ length: 20 }, (_, i) => i + 3));
    expect(signals.every((s) => s.severity === "warn")).toBe(true);
    expect(report.testIntegrity.verdict).toBe("warn");
  });
});
