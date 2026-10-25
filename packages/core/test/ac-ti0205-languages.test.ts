import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the test index are loaded inside the test body: the AC test is written before check() indexes test
// sources, so nothing that depends on that may run while the file loads. Every input is written here. The five checks
// of the AC run in one test, so the checks that give an empty list cannot pass on their own before the build.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TS = "src/a.test.ts";
const JS = "src/b.test.js";
const PY = "tests/test_c.py";

type Mode = "block" | "warn" | "off";
interface Report {
  testIntegrity: { signals: { id: string }[]; languages: string[] };
  messages: { code: string; level: string; text: string }[];
}

function edit(path: string, removed: string, addedLine: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -4 +4 @@",
    `-${removed}`,
    `+${addedLine}`,
    "",
  ].join("\n");
}

const jsText = (name: string) =>
  `import { expect, it } from "vitest";\nimport { total } from "./cart.js";\n\nit("${name}", () => {\n  expect(total([2, 3])).toBe(5);\n});\n`;
const pyText = (name: string) => `from cart import total\n\n\ndef ${name}():\n    assert total([2, 3]) == 5\n`;
/** A JS/TS test text with more than ten syntax errors. */
const broken = (name: string) =>
  `${jsText(name)}${Array.from({ length: 30 }, (_, i) => `const = ${i} ) ] }`).join("\n")}\n`;

const DIFF =
  edit(TS, 'it("adds", () => {', 'it("adds up", () => {') +
  edit(JS, 'it("adds", () => {', 'it("adds up", () => {') +
  edit(PY, "def test_adds():", "def test_adds_up():");

const side = (ts: string, js: string, py: string) => ({
  files: [
    { path: JS, text: js },
    { path: TS, text: ts },
    { path: PY, text: py },
  ],
  dropped: [],
});
const SOURCES = {
  base: side(jsText("adds"), jsText("adds"), pyText("test_adds")),
  head: side(jsText("adds up"), jsText("adds up"), pyText("test_adds_up")),
};

/** A plain-data Python index for the one .py file on each side, as the CLI and the Action pass it. */
const pyIndex = (name: string, text: string) => {
  const body = "assert total([2, 3]) == 5";
  return {
    path: PY,
    result: {
      parsed: true,
      syntaxErrors: 0,
      tests: [
        {
          kind: "test",
          name,
          nameDynamic: false,
          path: [name],
          line: text.split("\n").findIndex((l) => l.startsWith("def ")) + 1,
          endLine: text.split("\n").findIndex((l) => l.startsWith("def ")) + 2,
          modifiers: [],
          body,
          bodyHash: "0badc0de",
          assertionCount: 1,
          assertions: [{ chain: "assert", line: 5, awaited: false, inTryCatch: false, afterEarlyReturn: false }],
          guards: [],
        },
      ],
      mocks: [],
    },
  };
};
const PYTHON_INDEX = {
  available: true,
  base: [pyIndex("test_adds", pyText("test_adds"))],
  head: [pyIndex("test_adds_up", pyText("test_adds_up"))],
};

async function run(input: Record<string, unknown>, mode: Mode = "block"): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: DIFF },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [JS, TS, "src/cart.ts", PY],
    testIntegrityMode: { input: mode },
    ...input,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

describe("testIntegrity.languages names the languages indexed in the run", () => {
  it('AC-13: ["js", "py", "ts"] with a Python index, ["js", "ts"] without, [] when every file fails to parse, without sources and in mode off; without sources the report is the one it was', async () => {
    const all = await run({ testSources: SOURCES, pythonTestIndex: PYTHON_INDEX });
    expect(all.testIntegrity.languages).toEqual(["js", "py", "ts"]);

    const noPython = await run({ testSources: SOURCES });
    expect(noPython.testIntegrity.languages).toEqual(["js", "ts"]);

    const core = (await import("@pharn-ci/core")) as unknown as {
      indexTestFile(path: string, text: string): { parsed: boolean; reason?: string };
    };
    for (const [path, text] of [
      [TS, broken("adds")],
      [JS, broken("adds up")],
    ] as const) {
      expect(core.indexTestFile(path, text).parsed, `${path} does not parse`).toBe(false);
    }
    const unparsed = await run({
      testSources: {
        base: {
          files: [
            { path: JS, text: broken("adds") },
            { path: TS, text: broken("adds") },
          ],
          dropped: [],
        },
        head: {
          files: [
            { path: JS, text: broken("adds up") },
            { path: TS, text: broken("adds up") },
          ],
          dropped: [],
        },
      },
    });
    expect(unparsed.testIntegrity.languages).toEqual([]);

    const withoutSources = await run({});
    expect(withoutSources.testIntegrity.languages).toEqual([]);
    expect(
      withoutSources.messages.filter((m) =>
        ["TEST_INTEGRITY_TI02", "TEST_INTEGRITY_TI05", "TEST_INTEGRITY_INDEX_UNAVAILABLE"].includes(String(m.code)),
      ),
    ).toEqual([]);
    expect(withoutSources.testIntegrity.signals.filter((s) => ["TI02", "TI05"].includes(String(s.id)))).toEqual([]);

    const off = await run({ testSources: SOURCES, pythonTestIndex: PYTHON_INDEX }, "off");
    expect(off.testIntegrity.languages).toEqual([]);

    // A check input without sources gives the report it gave before this increment: the committed golden report.
    const { check } = await import("../src/check.js");
    const golden = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    } as unknown as Parameters<typeof check>[0]);
    expect(`${JSON.stringify(golden, null, 2)}\n`).toBe(fixture("golden/report.json"));
  });
});
