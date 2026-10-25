import { describe, expect, it } from "vitest";
import { harness, WORKSPACE } from "./harness.js";

// run() is loaded inside each test body: these tests are written before the `test-integrity` input exists, so
// nothing that depends on it may run while the file loads.

describe("action input test-integrity", () => {
  it("AC-9: the input beats a looser .pharn/ci.yml, shows in report.json and the comment, and does not fail the step", async () => {
    const { run } = await import("../src/run.js");
    const h = harness({
      inputs: { "test-integrity": "block", config: "" },
      files: { [`${WORKSPACE}/.pharn/ci.yml`]: "test_integrity:\n  mode: off\n" },
    });
    await run(h.deps);

    const text = h.written[h.outputs["report-path"] ?? ""];
    expect(text, "report.json was written").toBeDefined();
    const report = JSON.parse(text as string);
    expect(report.testIntegrity.mode).toBe("block");
    expect(report.testIntegrity.source).toBe("input");
    expect(h.posted.at(-1)).toContain("No test-integrity findings (mode: block).");
    expect(h.failed.filter((m) => /test.integrity/i.test(m))).toEqual([]);
  });

  it("AC-9: an input value outside block, warn and off fails the step naming the allowed values", async () => {
    const { run } = await import("../src/run.js");
    const h = harness({ inputs: { "test-integrity": "loud" } });
    await run(h.deps);

    expect(h.failed).toHaveLength(1);
    for (const allowed of ["block", "warn", "off"]) expect(h.failed[0]).toContain(allowed);
  });
});
