import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// docs-schema-levels: report.v2.json states the block-mode levels #126 shipped. (CORE-133: the THREAT-MODEL §3
// residual-numbering check moved out. CORE-132: the comparison of both schemas with an old commit was a history pin and
// is removed.)
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("docs-schema-levels", () => {
  it("report.v2.json states both block-mode levels", () => {
    const now = read("schema/report.v2.json");
    expect(now).toContain(
      "except DIFF_UNAVAILABLE, which is an error when a coverage threshold is set (0 included) or the test-integrity mode is block, and a warn otherwise.",
    );
    expect(now).toContain(
      "TEST_INTEGRITY_INDEX_UNAVAILABLE (warn, or error in mode block when TI02 and TI05, or TI09, did not run at all: touched",
    );
  });
});
