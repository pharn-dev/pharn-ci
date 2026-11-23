import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

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
  it("AC-12: the v2 schema names TEST_INTEGRITY_TI01", () => {
    expect(read("schema/report.v2.json")).toContain("TEST_INTEGRITY_TI01");
  });

  it.each(FIXTURES)("AC-12: fixtures/test-integrity/TI01/%s exists", (name) => {
    expect(existsSync(new URL(`fixtures/test-integrity/TI01/${name}`, ROOT))).toBe(true);
  });
});
