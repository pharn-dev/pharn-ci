import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI06 reads the expect subject, and the case
// dirs it reads are written by the build, so nothing the build adds may run while the file loads. Each case runs as
// the TI06 matcher-table test runs it: the test sources from base/ and head/, in mode block.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";

interface SourceFile {
  path: string;
  text: string;
}
interface Case {
  diff: string;
  base: SourceFile[];
  head: SourceFile[];
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

function loadCase(name: string): Case {
  const root = `${FIXTURES}test-integrity/TI06/${name}/`;
  return {
    diff: readFileSync(`${root}change.diff`, "utf8"),
    base: sideFiles(`${root}base`),
    head: sideFiles(`${root}head`),
  };
}

const diffPaths = (diff: string) => [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1] as string);

async function ti06(c: Case) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...c.head.map((f) => f.path), ...diffPaths(c.diff)])].sort(),
    testSources: { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } },
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report.testIntegrity.signals.filter((s) => String(s.id) === "TI06");
}

/** A test file whose first test holds `assertion` at line 7. */
const testFile = (assertion: string) =>
  [
    'import { describe, expect, it } from "vitest";',
    'import { total } from "./cart.js";',
    "",
    'describe("cart", () => {',
    '  it("totals the prices", () => {',
    "    const x = total([2, 3]);",
    `    ${assertion}`,
    "  });",
    "",
    '  it("totals an empty cart", () => {',
    "    expect(total([])).toBe(0);",
    "  });",
    "});",
    "",
  ].join("\n");

/** The case that rewrites line 7 of the test file from `from` to `to`. */
function inline(from: string, to: string): Case {
  const diff = [
    `diff --git a/${PATH} b/${PATH}`,
    "index 1111111..2222222 100644",
    `--- a/${PATH}`,
    `+++ b/${PATH}`,
    "@@ -7 +7 @@",
    `-    ${from}`,
    `+    ${to}`,
    "",
  ].join("\n");
  return {
    diff,
    base: [{ path: PATH, text: testFile(from) }],
    head: [{ path: PATH, text: testFile(to) }],
  };
}

const squash = (text: string) => text.replace(/\s+/g, "");

describe("TI06: equivalent matcher rewrites are not a weakening", () => {
  it("AC-10: typeof, instanceof, length, coercion, null and undefined rewrites to the matcher they equal give no TI06, in the case dirs and inline", async () => {
    const rewrites: Array<[string, string]> = [
      ["expect(x !== null).toBe(true);", "expect(x).not.toBeNull();"],
      ["expect(x === undefined).toBe(false);", "expect(x).toBeDefined();"],
      ["expect(Boolean(x)).toBe(false);", "expect(x).toBeFalsy();"],
      ["expect(x instanceof Object).toBe(true);", "expect(x).toBeInstanceOf(Object);"],
      ["expect.soft(typeof x).toBe('string');", "expect.soft(x).toBeTypeOf('string');"],
    ];
    for (const [from, to] of rewrites) {
      expect(await ti06(inline(from, to)), `${from} → ${to}`).toEqual([]);
    }

    // TanStack 12236: expect(typeof x).toBe('function') written over several lines becomes toBeTypeOf.
    const typeOf = loadCase("pass-typeof-to-be-type-of");
    const typeOfBase = typeOf.base.map((f) => f.text).join("\n");
    const typeOfHead = typeOf.head.map((f) => f.text).join("\n");
    expect(squash(typeOfBase), "the base holds expect(typeof …).toBe('function')").toMatch(
      /expect\(typeof[^;]*\)\.toBe\(['"]function['"]\)/,
    );
    expect(typeOfBase, "written over several lines").toMatch(/expect\(\s*\n[^;]*typeof|typeof[^;]*\n[^;]*\.toBe\(/);
    expect(typeOfHead, "the head holds toBeTypeOf('function')").toMatch(/\.toBeTypeOf\(\s*['"]function['"]\s*\)/);
    expect(await ti06(typeOf), "pass-typeof-to-be-type-of").toEqual([]);

    const holds: Array<[string, RegExp, RegExp]> = [
      ["pass-be-type-of-to-typeof", /\.toBeTypeOf\(/, /expect\(\s*typeof\b/],
      ["pass-instanceof-equivalent", /\binstanceof\b[^;]*\)\s*\.toBe\(\s*true\s*\)/, /\.toBeInstanceOf\(/],
      [
        "pass-length-equivalent",
        /\.length\s*\)\s*\.toBe\(|\.toHaveLength\(/,
        /\.toHaveLength\(|\.length\s*\)\s*\.toBe\(/,
      ],
      ["pass-truthy-coercion", /expect\(\s*!!/, /\.toBeTruthy\(\s*\)/],
    ];
    for (const [name, base, head] of holds) {
      const c = loadCase(name);
      expect(c.base.map((f) => f.text).join("\n"), `${name}: the base form`).toMatch(base);
      expect(c.head.map((f) => f.text).join("\n"), `${name}: the head form`).toMatch(head);
      expect(await ti06(c), name).toEqual([]);
    }
  });
});
