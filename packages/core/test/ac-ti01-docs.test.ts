import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeRow } from "./codeTable.js";

const ROOT = new URL("../../../", import.meta.url);

const FIXTURES = [
  "block-code-stays.diff",
  "block-rename-away.diff",
  "block-root-tests.diff",
  "pass-helper.diff",
  "pass-init-py.diff",
  "pass-fixture-json.diff",
  "pass-binary.diff",
  "info-with-source.diff",
  "info-package-removed.diff",
  "info-migration-ts.diff",
  "info-migration-mjs.diff",
];

// CORE-133: the CHANGELOG, README, LIMITS and THREAT-MODEL wording checks moved out. CORE-132: the report.v1.json
// comparison with an old commit was a history pin and is removed.
describe("TI01: schema and fixtures", () => {
  // CORE-140: the schema's code description is one sentence and a link to the code table of docs/output.md.
  it("AC-12: the code table names TEST_INTEGRITY_TI01", () => {
    expect(codeRow("TEST_INTEGRITY_TI01")).toContain("TI01:");
  });

  it.each(FIXTURES)("AC-12: fixtures/test-integrity/TI01/%s exists", (name) => {
    expect(existsSync(new URL(`fixtures/test-integrity/TI01/${name}`, ROOT))).toBe(true);
  });
});
