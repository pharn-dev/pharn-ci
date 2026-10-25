import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the config parser and the fixtures are loaded inside each test body: the AC tests are written before the
// tests-changed summary exists, so nothing that depends on it may run while the file loads. Each test first shows a
// control, the same kind of input with a test that does change, holding testIntegrity.changes, so an absent field
// below is absent because nothing changed (or the comparison did not run), not because the field never exists.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CART = "src/cart.test.ts";
const OLD = "src/old.test.ts";

type Mode = "block" | "warn" | "off";
interface SourceFile {
  path: string;
  text: string;
}
interface Report {
  testIntegrity: { changes?: unknown };
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const asFile = (report: unknown) => `${JSON.stringify(report, null, 2)}\n`;
const lines = (path: string) => fixture(path).trim().split("\n");

function sideFiles(dir: string): SourceFile[] {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

async function run(input: {
  diff: string;
  base?: SourceFile[];
  head?: SourceFile[];
  mode: Mode;
  repoFiles: string[];
}): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: input.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: input.repoFiles,
    ...(input.base === undefined || input.head === undefined
      ? {}
      : { testSources: { base: { files: input.base, dropped: [] }, head: { files: input.head, dropped: [] } } }),
    testIntegrityMode: { input: input.mode },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

const BASE_CART = [
  'import { describe, expect, it } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'describe("cart", () => {',
  '  it("adds the prices", () => {',
  "    expect(total([2, 3])).toBe(5);",
  "  });",
  '  it("totals an empty cart", () => {',
  "    expect(total([])).toBe(0);",
  "  });",
  "});",
  "",
];

/** A `--unified=0` diff of one modified file that swaps line `at` (1-based). */
const swapDiff = (path: string, at: number, was: string, now: string) =>
  `${[
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${at} +${at} @@`,
    `-${was}`,
    `+${now}`,
  ].join("\n")}\n`;

describe("testIntegrity.changes is absent unless a test changed", () => {
  it("AC-9: a diff whose touched test file changes no test, and a diff that only deletes a test file, give no testIntegrity.changes", async () => {
    // Control: the same file with one test's body changed holds the summary.
    const edited = [...BASE_CART];
    edited[5] = "    expect(total([2, 3, 4])).toBe(9);";
    const control = await run({
      diff: swapDiff(CART, 6, BASE_CART[5] as string, edited[5] as string),
      base: [{ path: CART, text: BASE_CART.join("\n") }],
      head: [{ path: CART, text: edited.join("\n") }],
      mode: "warn",
      repoFiles: [CART, "src/cart.ts"],
    });
    expect(control.testIntegrity.changes, "a changed test body gives the summary").toBeDefined();

    // Only the import line changes: both tests are unchanged pairs.
    const imports = [...BASE_CART];
    imports[1] = 'import { total } from "./cart.ts";';
    const unchanged = await run({
      diff: swapDiff(CART, 2, BASE_CART[1] as string, imports[1] as string),
      base: [{ path: CART, text: BASE_CART.join("\n") }],
      head: [{ path: CART, text: imports.join("\n") }],
      mode: "warn",
      repoFiles: [CART, "src/cart.ts"],
    });
    expect("changes" in unchanged.testIntegrity, "no test changed").toBe(false);

    // A deleted test file is not listed.
    const deleted = await run({
      diff: `${[
        `diff --git a/${OLD} b/${OLD}`,
        "deleted file mode 100644",
        "index 1111111..0000000",
        `--- a/${OLD}`,
        "+++ /dev/null",
        `@@ -1,${BASE_CART.length - 1} +0,0 @@`,
        ...BASE_CART.slice(0, -1).map((l) => `-${l}`),
      ].join("\n")}\n`,
      base: [{ path: OLD, text: BASE_CART.join("\n") }],
      head: [],
      mode: "warn",
      repoFiles: ["src/cart.ts"],
    });
    expect("changes" in deleted.testIntegrity, "a deleted test file only").toBe(false);
  });

  it("AC-9: a must-trigger input in mode off and without test sources gives no testIntegrity.changes, and every whole-report golden stays byte-identical", async () => {
    const root = `${FIXTURES}test-integrity/TI07/warn-tobe-number/`;
    const base = sideFiles(`${root}base`);
    const head = sideFiles(`${root}head`);
    expect(head.length, "the case has head test text").toBeGreaterThan(0);
    const diff = readFileSync(`${root}change.diff`, "utf8");
    const repoFiles = [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort();

    // Control: the input in mode block with its sources holds the summary.
    const control = await run({ diff, base, head, mode: "block", repoFiles });
    expect(control.testIntegrity.changes, "the edited test gives the summary").toBeDefined();

    const off = await run({ diff, base, head, mode: "off", repoFiles });
    expect("changes" in off.testIntegrity, "mode off").toBe(false);
    const without = await run({ diff, mode: "block", repoFiles });
    expect("changes" in without.testIntegrity, "no test sources").toBe(false);

    // Every whole-report golden, built as the test that owns each report.json builds it, with and without sources.
    const { check } = await import("../src/check.js");
    const { parseConfig } = await import("../src/config.js");
    type Input = Parameters<typeof check>[0];
    const exclusionsConfig = parseConfig(fixture("golden-exclusions/ci.yml")) as {
      coverage?: { exclude?: string[]; threshold?: number };
    };
    const golden = (dir: string) => ({
      version: "0.1.0",
      diff: { text: fixture(`${dir}/pr.diff`) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: lines(`${dir}/files.txt`),
    });
    const sets: Array<[string, Record<string, unknown>]> = [
      ["golden", { ...golden("golden"), coverage: { text: fixture("golden/coverage.info"), format: "lcov" } }],
      [
        "golden-cobertura",
        { ...golden("golden-cobertura"), coverage: { text: fixture("golden-cobertura/coverage.xml"), format: "auto" } },
      ],
      [
        "golden-exclusions",
        {
          ...golden("golden-exclusions"),
          coverage: { text: fixture("golden-exclusions/coverage.info"), format: "lcov" },
          threshold: exclusionsConfig.coverage?.threshold ?? null,
          exclude: exclusionsConfig.coverage?.exclude ?? [],
        },
      ],
      [
        "golden-multi",
        {
          ...golden("golden-multi"),
          coverage: {
            files: [
              { text: fixture("golden-multi/coverage-a.info"), file: "coverage/a/lcov.info" },
              { text: fixture("golden-multi/coverage-b.info"), file: "coverage/b/lcov.info" },
            ],
            format: "auto",
          },
        },
      ],
    ];
    const withGoldens = readdirSync(FIXTURES)
      .filter((name) => name.startsWith("golden"))
      .filter((name) => {
        try {
          return statSync(`${FIXTURES}${name}/report.json`).isFile();
        } catch {
          return false;
        }
      })
      .sort();
    expect(
      sets.map(([dir]) => dir),
      "every fixtures/golden*/report.json is checked",
    ).toEqual(withGoldens);
    const withText = {
      base: { files: [{ path: "a.test.ts", text: 'it("a", () => { expect(1).toBe(1); });\n' }], dropped: [] },
      head: { files: [], dropped: [{ path: "c.test.ts", reason: "binary" }] },
    };
    for (const [dir, input] of sets) {
      const committed = fixture(`${dir}/report.json`);
      for (const [label, extra] of [
        ["without sources", {}],
        ["with sources", { testSources: withText }],
      ] as const) {
        const report = check({ ...input, ...extra } as unknown as Input);
        expectValidReport(report);
        expect("changes" in (report as unknown as Report).testIntegrity, `${dir} ${label}`).toBe(false);
        expect(asFile(report), `${dir} ${label}: the committed report.json`).toBe(committed);
      }
    }
  });
});
