import { describe, expect, it } from "vitest";
import { codeRow } from "./codeTable.js";

// docs-schema-levels: the documentation states the block-mode levels #126 shipped. (CORE-133: the THREAT-MODEL §3
// residual-numbering check moved out. CORE-132: the comparison of both schemas with an old commit was a history pin and
// is removed. CORE-140: the schema's message-code description became one sentence and a link to the code table of
// docs/output.md, so the two rows of that table are read.)

describe("docs-schema-levels", () => {
  it("the code table states both block-mode levels", () => {
    expect(codeRow("DIFF_UNAVAILABLE")).toContain(
      "(`error` with a threshold or in `test-integrity: block`, else `warn`)",
    );
    expect(codeRow("TEST_INTEGRITY_INDEX_UNAVAILABLE")).toContain(
      "(`error` in mode `block` when TI02 and TI05, or TI09, did not run at all,",
    );
  });
});
