import { describe, expect, it } from "vitest";
import type { TestIntegritySignal } from "../src/report.js";
import { capFindings } from "../src/signals/findingCap.js";

// CORE-142 group 3: TI03, TI04, TI10 and TI13 cap their findings per file with capFindings instead of a cut loop each.
// Each keeps the order it cut by before, through the `rank` argument.

const signal = (line: number | null, severity: "block" | "warn"): TestIntegritySignal => ({
  id: "TI99",
  severity,
  path: "a.test.ts",
  line,
  detail: "x",
});

/** 25 findings in one file: lines 25 down to 1, the odd lines warn and the even ones block, then one without a line. */
const many = [
  ...Array.from({ length: 25 }, (_, i) => signal(25 - i, (25 - i) % 2 === 1 ? "warn" : "block")),
  signal(null, "warn"),
];

describe("capFindings", () => {
  it("by default keeps block first, then the lowest lines, a finding without a line last, in the input's order", () => {
    const { kept, omitted } = capFindings(many, 20);
    expect(kept.filter((s) => s.severity === "block")).toHaveLength(12);
    expect(kept.filter((s) => s.severity === "warn").map((s) => s.line)).toEqual([15, 13, 11, 9, 7, 5, 3, 1]);
    expect(omitted).toEqual([{ id: "TI99", path: "a.test.ts", count: 6 }]);
  });

  it("with a rank of its own: the lowest lines whatever the severity (TI13), or a finding without a line first (TI10)", () => {
    expect(
      capFindings(many, 20, () => 0)
        .kept.map((s) => s.line)
        .sort((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const lineless = capFindings(many, 20, (s) => (s.line === null ? 0 : 1)).kept;
    expect(lineless.map((s) => s.line)).toContain(null);
    expect(lineless.map((s) => s.line).filter((line) => line !== null)).toHaveLength(19);
  });
});
