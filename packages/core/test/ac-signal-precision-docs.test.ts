import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeRow } from "./codeTable.js";

// The schemas are read inside the test body, so the file loads whatever they say. (CORE-133: the LIMITS, PRECISION,
// CHANGELOG, README and THREAT-MODEL wording checks moved out.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** sha256 of schema/report.v1.json at the base commit 5860ba4. */
const V1_DIGEST = "c6cfd5b5afeada776fa89028f5ef29e06427d0e32529420184474e52ca77c731";

describe("signal precision: the documentation records the narrower rules", () => {
  // CORE-140: the schema's code description became one sentence and a link to the code table of docs/output.md, so the
  // TI11 and TI15 rows of that table are read.
  it("AC-13: the code table names the caps and v1 is byte-identical", () => {
    const ti11Code = codeRow("TEST_INTEGRITY_TI11");
    expect(ti11Code, "TI11 has no warn path for a removed test step").not.toMatch(/\bjob that ran tests\b/);
    expect(ti11Code, "TI11: a removed test command is error in mode block").toContain(
      "a removed test command or `pull_request` trigger (`error` in mode `block`",
    );
    const ti15Code = codeRow("TEST_INTEGRITY_TI15");
    expect(ti15Code, "the TI15 cap of 10").toMatch(/\b10\b/);
    expect(ti15Code, "the TI15 cap per change").toMatch(/\bper change\b/);

    const v1 = createHash("sha256")
      .update(readFileSync(`${ROOT}schema/report.v1.json`))
      .digest("hex");
    expect(v1, "schema/report.v1.json is byte-identical to the base commit").toBe(V1_DIGEST);
  });
});
