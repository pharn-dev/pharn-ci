import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI06 reads the expect subject, and the case
// dir it reads is written by the build, so nothing the build adds may run while the file loads. A real weakening still
// warns, the earlier TI06 case dirs keep their signals, and the Skylos nine run as the TI06 Skylos test runs them.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";

/** The TI06 case dirs of the base commit 5860ba4. */
const EARLIER = [
  "pass-added-tests",
  "pass-became-skip",
  "pass-chai",
  "pass-cross-file",
  "pass-guard-raised",
  "pass-neutral-matchers",
  "pass-py-equal-to-assert",
  "pass-strict-equal",
  "pass-tobe-toequal",
  "pass-tothrow-narrowed",
  "pass-truthy-beside",
  "pass-try-kept",
  "warn-assert-ok",
  "warn-called-with",
  "warn-early-return",
  "warn-guard-lowered",
  "warn-guard-removed",
  "warn-has-assertions-removed",
  "warn-joined",
  "warn-null-not-undefined",
  "warn-property-instance",
  "warn-py-assert-true",
  "warn-py-assert-truthy",
  "warn-py-tautology",
  "warn-soft-truthy",
  "warn-tautology-assert",
  "warn-tautology-expect",
  "warn-tobe-truthy",
  "warn-toequal-defined",
  "warn-tothrow-bare",
  "warn-try-catch",
];
/**
 * sha256 of the JSON list of { fixture, signals } over EARLIER in that order, where signals are the case's TI06
 * signals as { id, severity, path, line, detail }, as check() gave them at the base commit 5860ba4 (the Python cases
 * run without a Python index here, as the matcher-table test runs them).
 */
const EARLIER_DIGEST = "11b8a9d167acbefb668d5b8690c36ce273dcb4733e47b20f08e149e1abb66c2e";

const NINE = [
  "deleted-test",
  "added-skip",
  "emptied-assertion",
  "deselect-setting",
  "hard-coded-answer",
  "always-true-matcher",
  "replaced-test",
  "loosened-assertion",
  "edited-expected-value",
] as const;
const WITH_SOURCES = new Set([
  "emptied-assertion",
  "deselect-setting",
  "replaced-test",
  "loosened-assertion",
  "edited-expected-value",
]);

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
  try {
    statSync(dir);
  } catch {
    return [];
  }
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
  return report.testIntegrity.signals
    .filter((s) => String(s.id) === "TI06")
    .map((s) => ({ id: String(s.id), severity: s.severity, path: s.path, line: s.line, detail: s.detail }));
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

async function runNine(): Promise<Map<string, Array<{ id: string; severity: string }>>> {
  const { check } = await import("../src/check.js");
  const out = new Map<string, Array<{ id: string; severity: string }>>();
  for (const name of NINE) {
    const sources = WITH_SOURCES.has(name)
      ? {
          testSources: {
            base: { files: sideFiles(`${FIXTURES}skylos-nine-sources/${name}/base`), dropped: [] },
            head: { files: sideFiles(`${FIXTURES}skylos-nine-sources/${name}/head`), dropped: [] },
          },
        }
      : {};
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: fixture(`skylos-nine/${name}/change.diff`) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture(`skylos-nine/${name}/files.txt`).trim().split("\n"),
      testIntegrityMode: { input: "block" },
      ...sources,
    } as unknown as Parameters<typeof check>[0]);
    expectValidReport(report);
    out.set(
      name,
      report.testIntegrity.signals.map((s) => ({ id: String(s.id), severity: s.severity })),
    );
  }
  return out;
}

describe("TI06: a real weakening still warns", () => {
  it("AC-11: toBe(5) → toBeTypeOf('number'), toBe(true) → toBeTruthy() and toEqual({ a: 1 }) → toBeDefined() each give one warn TI06, typeof → toBeTruthy() gives none, the earlier TI06 case dirs keep their signals, and the Skylos nine still catch 7 of 9 with loosened-assertion", async () => {
    // The recorded weak-to-weak limit: toBeTypeOf and toBeTruthy are both weak, so no TI06.
    expect(
      await ti06(inline("expect(typeof x).toBe('function');", "expect(x).toBeTruthy();")),
      "expect(typeof x).toBe('function') → expect(x).toBeTruthy()",
    ).toEqual([]);

    const weakenings: Array<[string, string]> = [
      ["expect(x).toBe(true);", "expect(x).toBeTruthy();"],
      ["expect(x).toEqual({ a: 1 });", "expect(x).toBeDefined();"],
    ];
    for (const [from, to] of weakenings) {
      const signals = await ti06(inline(from, to));
      expect(signals, `${from} → ${to}`).toHaveLength(1);
      expect(signals[0], `${from} → ${to}`).toMatchObject({ severity: "warn", path: PATH });
    }

    const toTypeOf = loadCase("warn-to-be-to-type-of");
    expect(toTypeOf.base.map((f) => f.text).join("\n"), "the base holds toBe(5)").toMatch(/\.toBe\(\s*5\s*\)/);
    expect(toTypeOf.head.map((f) => f.text).join("\n"), "the head holds toBeTypeOf('number')").toMatch(
      /\.toBeTypeOf\(\s*['"]number['"]\s*\)/,
    );
    const fixtureSignals = await ti06(toTypeOf);
    expect(fixtureSignals, "warn-to-be-to-type-of").toHaveLength(1);
    expect(fixtureSignals[0]?.severity, "warn-to-be-to-type-of").toBe("warn");

    // Every TI06 case dir of the base commit gives what it gave there.
    const records: Array<{ fixture: string; signals: unknown[] }> = [];
    for (const name of EARLIER) records.push({ fixture: name, signals: await ti06(loadCase(name)) });
    expect(records.filter((r) => r.signals.length > 0).length, "the earlier warn cases signal").toBe(16);
    expect(
      createHash("sha256").update(JSON.stringify(records)).digest("hex"),
      "the earlier TI06 case dirs give their base-commit signals",
    ).toBe(EARLIER_DIGEST);

    // The Skylos nine: 7 of 9 caught, loosened-assertion by a warn TI06.
    const nine = await runNine();
    expect(nine.size).toBe(9);
    const caught = [...nine].filter(([, signals]) => signals.length > 0).map(([name]) => name);
    expect(caught, "7 of 9 caught").toHaveLength(7);
    expect(caught).toContain("loosened-assertion");
    expect(nine.get("loosened-assertion"), "loosened-assertion: one warn TI06").toEqual([
      { id: "TI06", severity: "warn" },
    ]);
  });
});
