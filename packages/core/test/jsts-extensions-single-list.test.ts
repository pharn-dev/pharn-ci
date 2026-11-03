import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The eight JS/TS extensions live in src/jsTsExtensions.ts alone. A second, hand-written list would let the sites drift
// apart again (review 2026-11-01, finding 13), so no other source file may spell the four extensions only the newer
// lists got wrong: as a string literal, or as an `mjs|cjs` regex alternation.

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const EXEMPT = new Set(["jsTsExtensions.ts", "testConfig/kinds.ts"]);
const LITERAL = /["'](?:mjs|cjs|mts|cts)["']/;
const ALTERNATION = /mjs\|cjs|cjs\|mjs|mts\|cts|cts\|mts/;

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(dir, name));
}

describe("one JS/TS extension list", () => {
  it("no source file outside jsTsExtensions.ts spells mjs, cjs, mts or cts as a literal or an alternation", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file).split("\\").join("/");
      if (EXEMPT.has(rel)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (LITERAL.test(line) || ALTERNATION.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
