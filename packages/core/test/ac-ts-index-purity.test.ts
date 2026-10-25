import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// purityViolations is loaded inside the test body, like the other AC tests: nothing the build changes runs while the
// file loads.

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

/** Import lines that must stay violations, each with the specifier its violation names. */
const STILL_BANNED: [line: string, specifier: string][] = [
  ['import ts from "typescript";', "typescript"],
  ['import x from "typescript5/lib/typescript.js";', "typescript5/lib/typescript.js"],
  ['import x from "typescript55";', "typescript55"],
  ['import { readFileSync } from "node:fs";', "node:fs"],
  ['import x from "@pharn-ci/node-io";', "@pharn-ci/node-io"],
];

describe("packages/core purity: the typescript5 exception", () => {
  it("AC-13: allows exactly the import specifier typescript5, and every core source still passes", async () => {
    const { purityViolations } = await import("./purity-check.js");
    expect(purityViolations('import ts from "typescript5";\n')).toEqual([]);
    for (const [line, specifier] of STILL_BANNED) {
      const violations = purityViolations(`${line}\n`);
      expect(
        violations.some((v) => v.includes(`"${specifier}"`)),
        `${line} gives a violation naming ${specifier}: ${JSON.stringify(violations)}`,
      ).toBe(true);
    }
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(purityViolations(readFileSync(file, "utf8")), file.slice(SRC.length)).toEqual([]);
    }
  });
});
