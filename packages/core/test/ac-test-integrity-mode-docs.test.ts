import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// CORE-133: the action.yml description, CHANGELOG, README and THREAT-MODEL wording checks moved out;
// docs-contract.test.ts checks the README input row.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
/** The commit before this increment. */
const BEFORE = "e39cda3780c7df9c14c84018d187c2c9adfc7f9a";

describe("test-integrity mode: schema", () => {
  it("AC-11: report.v2.json lists both new codes and report.v1.json is byte-identical to the base commit's", () => {
    const v2 = read("schema/report.v2.json");
    expect(v2).toContain("TEST_INTEGRITY_MODE_IGNORED");
    expect(v2).toContain("TEST_INTEGRITY_OFF");

    const before = execFileSync("git", ["show", `${BEFORE}:schema/report.v1.json`], {
      cwd: fileURLToPath(ROOT),
      encoding: "utf8",
    });
    expect(read("schema/report.v1.json")).toBe(before);
  });
});
