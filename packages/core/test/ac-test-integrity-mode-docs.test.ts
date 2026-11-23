import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// CORE-133: the action.yml description, CHANGELOG, README and THREAT-MODEL wording checks moved out;
// docs-contract.test.ts checks the README input row. CORE-132: the report.v1.json comparison with an old commit was a
// history pin and is removed.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

describe("test-integrity mode: schema", () => {
  it("AC-11: report.v2.json lists both new codes", () => {
    const v2 = read("schema/report.v2.json");
    expect(v2).toContain("TEST_INTEGRITY_MODE_IGNORED");
    expect(v2).toContain("TEST_INTEGRITY_OFF");
  });
});
