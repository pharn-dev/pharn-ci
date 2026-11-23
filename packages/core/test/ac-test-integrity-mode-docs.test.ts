import { describe, expect, it } from "vitest";
import { codeRow } from "./codeTable.js";

// CORE-133: the action.yml description, CHANGELOG, README and THREAT-MODEL wording checks moved out;
// docs-contract.test.ts checks the README input row. CORE-132: the report.v1.json comparison with an old commit was a
// history pin and is removed. CORE-140: the schema's message-code description became one sentence and a link to the
// code table of docs/output.md, so the codes are read from that table.

describe("test-integrity mode: the code table", () => {
  it("AC-11: the code table lists both new codes", () => {
    expect(codeRow("TEST_INTEGRITY_MODE_IGNORED")).toContain("`warn`");
    expect(codeRow("TEST_INTEGRITY_OFF")).toContain("`info`");
  });
});
