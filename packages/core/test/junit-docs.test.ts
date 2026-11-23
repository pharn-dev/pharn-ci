import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Flaky tests (A6): the schema names the four codes and describes `flaky`. (CORE-133: the README, LIMITS, THREAT-MODEL,
// SECURITY, CHANGELOG and action.yml wording checks moved out; docs-contract.test.ts checks the README input and code
// rows. CORE-132: the byte-for-byte pins of the v0.8.0 code text and the flaky description, kept valid by the
// schema-text helpers of the history pins, are removed; the codes and the description are checked as they are.)

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
/** The flaky-test message codes. */
const FLAKY_CODES = ["FLAKY_QUARANTINED_FAILURES", "JUNIT_INVALID", "JUNIT_NOT_FOUND", "JUNIT_TOO_LARGE"];

describe("flaky tests: schema", () => {
  it("report.v2.json names the four codes and describes flaky, and report.ts has the codes", () => {
    const schema = JSON.parse(read("schema/report.v2.json")) as {
      properties: { flaky: { description?: string } };
      $defs: { message: { properties: { code: { description: string } } } };
    };
    expect(typeof schema.properties.flaky.description, "the flaky description").toBe("string");
    const description = schema.$defs.message.properties.code.description;
    const report = read("packages/core/src/report.ts");
    for (const code of FLAKY_CODES) {
      expect(description, code).toContain(code);
      expect(report, code).toContain(`| "${code}"`);
    }
  });
});
