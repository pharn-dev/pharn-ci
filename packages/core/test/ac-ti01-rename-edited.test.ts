import { describe, expect, it } from "vitest";
import { messagesOf, runFixture, signalsOf } from "./ac-e1-fix-shared.js";

// A rename shows only the lines it edits, never the tests the file keeps, so a test file renamed to a path that is not
// a test file counts whatever its removed lines hold.

describe("TI01: a test file renamed away with edits", () => {
  it("renamed to a .bak path with one comment line removed: a block finding on the old path, and the check fails", async () => {
    const report = await runFixture("TI01/block-rename-away-edited.diff");
    const signals = signalsOf(report, "TI01");
    expect(signals).toEqual([
      expect.objectContaining({
        path: "src/user.test.ts",
        severity: "block",
        line: null,
        detail: "Test file renamed to a path that is not a test file, so its tests are no longer found by name.",
      }),
    ]);
    expect(messagesOf(report, "TEST_INTEGRITY_TI01")[0]?.level).toBe("error");
    expect(report.verdict).toBe("fail");
    expect(signalsOf(await runFixture("TI01/block-rename-away-edited.diff", "warn"), "TI01")[0]?.severity).toBe("warn");
  });

  it("renamed to another test path with the same edit: no finding", async () => {
    const report = await runFixture("TI01/pass-rename-to-test-edited.diff");
    expect(signalsOf(report, "TI01")).toEqual([]);
    expect(messagesOf(report, "TEST_INTEGRITY_TI01")).toEqual([]);
  });
});
