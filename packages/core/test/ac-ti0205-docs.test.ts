import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeRow } from "./codeTable.js";

// The schemas document TI02, TI05 and their three message codes, and the new fixture directories hold must-trigger and
// must-not-trigger cases in the agreed shape. Files only; nothing the build adds is imported. (CORE-133: the
// CHANGELOG, README, LIMITS and THREAT-MODEL wording checks moved out; docs-contract.test.ts checks the README code
// rows. CORE-132: the report.v1.json comparison with an old commit was a history pin and is removed.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CODES = ["TEST_INTEGRITY_TI02", "TEST_INTEGRITY_TI05", "TEST_INTEGRITY_INDEX_UNAVAILABLE"];

/** Every file under `dir`, relative to it. */
function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => statSync(join(dir, name)).isFile());
}

describe("TI02 and TI05: schema and fixtures", () => {
  it("AC-20: the code table documents the three codes", () => {
    // CORE-140: the schema's code description became one sentence and a link to the code table of docs/output.md.
    for (const code of CODES) expect(codeRow(code), code).toMatch(/`(?:error|warn|info)`/);
  });

  it("AC-20: fixtures/test-integrity/TI02/ and TI05/ each hold must-trigger and must-not-trigger cases, text files ending .txt and diffs ending .diff of fewer than 1000 lines", () => {
    for (const signal of ["TI02", "TI05"]) {
      const dir = join(ROOT, "fixtures/test-integrity", signal);
      const cases = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      expect(
        cases.filter((name) => /^(block|warn)-/.test(name)).length,
        `${signal}: must-trigger cases`,
      ).toBeGreaterThan(0);
      expect(
        cases.filter((name) => name.startsWith("pass-")).length,
        `${signal}: must-not-trigger cases`,
      ).toBeGreaterThan(0);
      for (const name of cases) {
        const files = walk(join(dir, name));
        expect(files, `${signal}/${name}: a diff`).toContain("change.diff");
        for (const file of files) {
          const path = `${signal}/${name}/${file}`;
          if (file.endsWith(".diff")) {
            const count = readFileSync(join(dir, name, file), "utf8").split("\n").length;
            expect(count, `${path}: fewer than 1000 lines`).toBeLessThan(1000);
          } else {
            expect(file.endsWith(".txt"), `${path}: a text file ends in .txt`).toBe(true);
          }
        }
      }
    }
  });
});
