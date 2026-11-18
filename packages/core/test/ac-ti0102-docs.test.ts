import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The fixture directories are read inside the test body: the AC tests are written before
// fixtures/test-integrity-precision/ exists, so nothing that depends on it may run while the file loads.
// (CORE-133: the LIMITS, PRECISION and CHANGELOG wording checks moved out.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PRECISION_FIXTURES = `${ROOT}fixtures/test-integrity-precision/`;

const TI02_CASES = [
  "pass-rename-setup-moved",
  "pass-rename-assertion-changed",
  "pass-rename-literal-changed",
  "ti06-rename-weakened",
  "pass-each-replaced",
  "pass-moved-near-identical",
  "pass-moved-name-contained",
  "block-suite-rewritten",
  "block-hollow-similar-name",
  "block-group-replaced",
  "block-fails-fixed",
  "block-slot-dissimilar",
  "block-each-dissimilar",
  "block-similar-name-elsewhere",
];
const TI01_CASES = [
  "info-moved-names",
  "block-name-missing",
  "block-no-assertions",
  "block-trivial-same-names",
  "info-moved-names-py",
  "pass-snap-renamed",
  "pass-snap-deleted",
];

const textFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(
        (n) => n.endsWith(".txt") && statSync(join(dir, n)).isFile(),
      )
    : [];

describe("TI01 and TI02 precision: the fixtures", () => {
  it("AC-15: fixtures/test-integrity-precision/TI02 and TI01 hold every named case as change.diff with base/ and head/ text files", () => {
    for (const [dir, cases] of [
      ["TI02", TI02_CASES],
      ["TI01", TI01_CASES],
    ] as const) {
      for (const name of cases) {
        const root = `${PRECISION_FIXTURES}${dir}/${name}/`;
        expect(existsSync(`${root}change.diff`), `${dir}/${name}/change.diff`).toBe(true);
        expect(textFiles(`${root}base`).length, `${dir}/${name}/base/ holds text files`).toBeGreaterThan(0);
        expect(textFiles(`${root}head`).length, `${dir}/${name}/head/ holds text files`).toBeGreaterThan(0);
      }
    }
  });
});
