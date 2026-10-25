import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI03 and TI04 exist, so nothing the
// build adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

/** One hunk of a `--unified=0` diff: the first old and new line of the change, the removed and the added lines. */
type Hunk = [oldStart: number, newStart: number, removed: string[], added: string[]];

function hunk([oldStart, newStart, removed, added]: Hunk): string[] {
  const oldPart = removed.length === 0 ? `${oldStart - 1},0` : `${oldStart},${removed.length}`;
  const newPart = added.length === 0 ? `${newStart - 1},0` : `${newStart},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

function edit(path: string, ...hunks: Hunk[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap((h) => hunk(h))].join("\n")}\n`;
}

/** A file the diff adds (status added). */
function addFile(path: string, lines: string[]): string {
  const head = [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..2222222",
    "--- /dev/null",
    `+++ b/${path}`,
  ];
  return `${[...head, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

async function run(diff: string) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const ti03 = (report: Awaited<ReturnType<typeof run>>) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI03");

/** [label, diff, path, new-file lines of the skips]. */
const ADDED_TESTS: Array<[string, string, string, number[]]> = [
  [
    "xfail above a def test_new the hunk adds",
    edit("tests/test_user.py", [
      20,
      20,
      [],
      ['@pytest.mark.xfail(reason="bug 12")', "def test_new():", "    assert compute() == 3"],
    ]),
    "tests/test_user.py",
    [20],
  ],
  [
    "a named it.skip with no removed test of that name",
    edit("src/user.test.ts", [30, 30, [], ["it.skip('brand new', () => {", "  expect(1).toBe(1);", "});"]]),
    "src/user.test.ts",
    [30],
  ],
  [
    "a new JS test file with a named and a conditional skip",
    addFile("src/new.test.ts", [
      'import { it, test } from "vitest";',
      "it.skip('a', () => {",
      '  test.skip(isMobile, "x")',
      "  expect(1).toBe(1);",
      "});",
    ]),
    "src/new.test.ts",
    [2, 3],
  ],
  [
    "a new Python test file with a skip decorator",
    addFile("tests/test_new.py", [
      "import pytest",
      "",
      '@pytest.mark.skip(reason="wip")',
      "def test_a():",
      "    assert True",
    ]),
    "tests/test_new.py",
    [3],
  ],
];

describe("TI03: a skip in a test the change adds", () => {
  it("AC-8: a decorator above an added test, a skip on an added test name and skips in added files are warn", async () => {
    const details = new Set<string>();
    for (const [label, diff, path, lines] of ADDED_TESTS) {
      const signals = ti03(await run(diff));
      expect(
        signals.map((s) => ({ path: s.path, line: s.line, severity: s.severity })),
        label,
      ).toEqual(lines.map((line) => ({ path, line, severity: "warn" })));
      for (const signal of signals) details.add(signal.detail);
    }

    // One fixed sentence for the category: the "skip in a test the change adds" sentence.
    expect(details.size).toBe(1);
    const [detail] = [...details] as [string];
    expect(detail.length).toBeGreaterThan(0);
    expect(detail.length).toBeLessThanOrEqual(300);
    expect(detail).not.toMatch(/unconditional/i);
    for (const text of ["bug 12", "brand new", "wip"]) expect(detail).not.toContain(text);
  });
});
