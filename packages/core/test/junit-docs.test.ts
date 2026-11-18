import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withoutR3SchemaTextEdits } from "./r3-schema-text.js";
import { V080_CODE_TEXT, V080_FLAKY_CODES, V080_FLAKY_SCHEMA_TEXT, V080_FLAKY_TEXT } from "./v080-codes.js";

// Flaky tests (A6): the schema names the four codes and describes `flaky` exactly once. (CORE-133: the README, LIMITS,
// THREAT-MODEL, SECURITY, CHANGELOG and action.yml wording checks moved out; docs-contract.test.ts checks the README
// input and code rows.)

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

describe("flaky tests: schema", () => {
  it("report.v2.json carries the v0.8.0 code text and the flaky description once, and report.ts the codes", () => {
    // Re-pinned for the R3 schema text follow-up: its six description edits (one inside the v0.8.0 code text) are put
    // back first (r3-schema-text.ts pins them exactly).
    const schema = withoutR3SchemaTextEdits(read("schema/report.v2.json"));
    expect(schema.split(V080_FLAKY_SCHEMA_TEXT)).toHaveLength(2);
    expect(schema.split(V080_CODE_TEXT)).toHaveLength(2);
    expect(V080_CODE_TEXT).toContain(V080_FLAKY_TEXT);
    const report = read("packages/core/src/report.ts");
    for (const code of V080_FLAKY_CODES) {
      expect(V080_FLAKY_TEXT, code).toContain(code);
      expect(report, code).toContain(`| "${code}"`);
    }
  });
});
