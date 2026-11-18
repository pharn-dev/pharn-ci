import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
/** The commit before this increment. */
const BEFORE = "b145a7f3e7ad2b8b13af7b591a3186128a355cc6";

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

// CORE-133: the CHANGELOG, README, LIMITS and THREAT-MODEL wording checks moved out.
describe("TI01: schema and fixtures", () => {
  it("AC-12: the v2 schema names TEST_INTEGRITY_TI01 and the v1 schema is byte-identical to the base commit's", () => {
    expect(read("schema/report.v2.json")).toContain("TEST_INTEGRITY_TI01");
    const before = execFileSync("git", ["show", `${BEFORE}:schema/report.v1.json`], {
      cwd: fileURLToPath(ROOT),
      encoding: "utf8",
    });
    expect(read("schema/report.v1.json")).toBe(before);
  });

  it.each(FIXTURES)("AC-12: fixtures/test-integrity/TI01/%s exists", (name) => {
    expect(existsSync(new URL(`fixtures/test-integrity/TI01/${name}`, ROOT))).toBe(true);
  });
});
