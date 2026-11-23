import { describe, expect, it } from "vitest";
import { codeRow } from "./codeTable.js";

// CORE-50 (binary-diff-not-blind). The rows of the five codes this change touches name the binary case. (CORE-132: the
// comparisons of report.v1.json and report.v2.json with an old commit were history pins and are removed. CORE-140: the
// schema's message-code description became one sentence and a link to the code table of docs/output.md, so the
// passages are read from that table's rows.)

const CODES = ["TEST_INTEGRITY_TI01", "TEST_INTEGRITY_TI10", "TEST_INTEGRITY_TI11", "TEST_INTEGRITY_TI14"] as const;
const UNAVAILABLE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";

describe("CORE-50: the documentation describes the binary case", () => {
  it("AC-19: the TI01, TI10, TI11, TI14 and TEST_INTEGRITY_INDEX_UNAVAILABLE rows of the code table name the binary case and the reason binary", () => {
    for (const code of [...CODES, UNAVAILABLE]) {
      expect(codeRow(code), `${code}: the row names the binary case`).toMatch(/\bbinary\b/);
    }
    expect(codeRow(UNAVAILABLE), `${UNAVAILABLE}: names the reason binary`).toMatch(/reason (?:code )?`?binary\b/);
  });
});
