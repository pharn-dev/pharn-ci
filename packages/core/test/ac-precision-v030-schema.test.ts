import { describe, expect, it } from "vitest";
import { codeRow } from "./codeTable.js";

// precision-v030: the TEST_INTEGRITY_TI15 documentation states the level `info`, never `warn`. (CORE-132: the
// comparisons of report.v1.json and of every other report.v2.json byte with an old commit were history pins and are
// removed. CORE-140: the schema's message-code description became one sentence and a link to the code table of
// docs/output.md, so the TI15 row of that table is read.)

describe("docs: the TI15 level sentence", () => {
  it("AC-9: the TEST_INTEGRITY_TI15 row says info, and not warn", () => {
    const row = codeRow("TEST_INTEGRITY_TI15");
    expect(row).toContain("(`info`)");
    expect(row).not.toContain("`warn`");
  });
});
