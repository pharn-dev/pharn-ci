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

// The AC-1 diff: seven narrowing markers in one file.
const AC1 = [
  edit("src/user.test.ts", [
    10,
    10,
    [],
    [
      "it.only('a', () => {",
      "});",
      'test.only("b", () => {',
      "});",
      "describe.only('c', () => {",
      "  test.describe.only('d', () => {",
      "    describe.only.each([1, 2])('e %s', (n) => {",
      "      fit('f', () => {",
      "      });",
      "    });",
      "  });",
      "});",
      "fdescribe('g', () => {",
      "});",
    ],
  ]),
];

// The AC-4 diffs: an existing test turned into a skip, the name kept.
const AC4 = (
  [
    ["it('creates a user', () => {", "it.skip('creates a user', () => {"],
    ['it("creates a user", () => {', "it.skip('creates a user', () => {"],
    ["test('n', () => {", "test.todo('n')"],
    ["describe('s', () => {", "xdescribe('s', () => {"],
    ["it('n', () => {", "xit('n', () => {"],
    ["test.describe('s', () => {", "test.describe.skip('s', () => {"],
    ["it('n', () => {", "it.fails('n', () => {"],
    ["it('n', () => {", "it.skipIf(true)('n', () => {"],
    ["it('n', () => {", "it.runIf(false)('n', () => {"],
  ] as const
).map(([removed, added]) => edit("src/user.test.ts", [12, 12, [removed], [added]]));

// The AC-6 diffs: conditional skips.
const AC6 = [
  edit("e2e/login.spec.ts", [14, 14, [], ['  test.skip(isMobile, "not on mobile")']]),
  edit("e2e/login.spec.ts", [
    14,
    14,
    [],
    ['  test.skip(({ browserName }) => browserName === "firefox", "flaky on firefox")'],
  ]),
  edit("src/user.test.ts", [14, 14, ["it('n', () => {"], ["it.skipIf(process.env.CI)('n', () => {"]]),
  edit("src/user.test.ts", [14, 14, ["it('n', () => {"], ["it.runIf(hasDocker)('n', () => {"]]),
  edit("tests/test_io.py", [14, 14, [], ['@pytest.mark.skipif(sys.platform == "win32", reason="posix only")']]),
  edit("tests/test_io.py", [14, 14, [], ['@unittest.skipIf(IS_CI, "slow")']]),
  edit("tests/test_io.py", [14, 14, [], ['@unittest.skipUnless(shutil.which("docker"), "needs docker")']]),
  edit("tests/test_io.py", [14, 14, [], ['@pytest.mark.xfail(sys.version_info < (3, 11), reason="old python")']]),
];

// The AC-7 diffs: skips inside a test body.
const AC7 = [
  edit("tests/test_io.py", [30, 30, [], ['    if not shutil.which("docker"):', '        pytest.skip("no docker")']]),
  edit("pkg/net_test.go", [30, 30, [], ["\tif testing.Short() {", '\t\tt.Skip("needs network")', "\t}"]]),
  edit("pkg/net_test.go", [30, 30, [], ['\tt.Skipf("no %s", name)']]),
  edit("pkg/net_test.go", [30, 30, [], ["\tt.SkipNow()"]]),
  edit("src/user.test.ts", [30, 30, [], ["  test.skip()"]]),
  edit("src/user.test.ts", [30, 30, [], ["  test.skip(true)"]]),
  edit("src/user.test.ts", [30, 30, [], ["  this.skip()"]]),
];

// The AC-8 diffs: skips in tests the change adds.
const AC8 = [
  edit("tests/test_user.py", [
    20,
    20,
    [],
    ['@pytest.mark.xfail(reason="bug 12")', "def test_new():", "    assert compute() == 3"],
  ]),
  edit("src/user.test.ts", [30, 30, [], ["it.skip('brand new', () => {", "  expect(1).toBe(1);", "});"]]),
  addFile("src/new.test.ts", [
    'import { it, test } from "vitest";',
    "it.skip('a', () => {",
    '  test.skip(isMobile, "x")',
    "  expect(1).toBe(1);",
    "});",
  ]),
  addFile("tests/test_new.py", [
    "import pytest",
    "",
    '@pytest.mark.skip(reason="wip")',
    "def test_a():",
    "    assert True",
  ]),
];

/** Expression text from the fixtures that is neither a quoted string nor a whole line. */
const EXPRESSIONS = [
  "isMobile",
  "browserName",
  "process.env.CI",
  "hasDocker",
  "sys.platform",
  "IS_CI",
  "shutil.which",
  "sys.version_info",
  "testing.Short",
  "compute()",
];

/** Text from the added and removed lines of the diffs that must not reach a detail or a message. */
function forbiddenText(diffs: string[]): string[] {
  const out = new Set<string>(EXPRESSIONS);
  for (const diff of diffs) {
    for (const raw of diff.split("\n")) {
      if (!/^[+-]/.test(raw) || raw.startsWith("+++") || raw.startsWith("---")) continue;
      const line = raw.slice(1).trim();
      if (line.length >= 6) out.add(line);
      for (const match of line.matchAll(/(["'`])((?:(?!\1).)*)\1/g)) {
        const content = match[2] as string;
        if (content.length >= 3) out.add(content);
        else if (content.length > 0) for (const q of ["'", '"', "`"]) out.add(`${q}${content}${q}`);
      }
    }
  }
  return [...out];
}

describe("TI03 and TI04: the fixed details", () => {
  it("AC-10: one detail per TI03 category, four different ones, all at most 300 characters, no fixture text in details or messages", async () => {
    const groups: Array<[string, string, string[]]> = [
      ["TI03", "unconditional skip on an existing test", AC4],
      ["TI03", "conditional skip", AC6],
      ["TI03", "skip the diff cannot place", AC7],
      ["TI03", "skip in a test the change adds", AC8],
      ["TI04", "narrowing marker", AC1],
    ];
    const forbidden = forbiddenText([...AC1, ...AC4, ...AC6, ...AC7, ...AC8]);
    const detailsByGroup = new Map<string, Set<string>>();
    const texts: string[] = [];

    for (const [id, category, diffs] of groups) {
      const details = new Set<string>();
      for (const diff of diffs) {
        const report = await run(diff);
        const signals = report.testIntegrity.signals.filter((signal) => String(signal.id) === id);
        expect(signals.length, `${category}: ${diff}`).toBeGreaterThan(0);
        for (const signal of signals) {
          details.add(signal.detail);
          texts.push(signal.detail);
        }
        const messages = report.messages.filter((m) => (m.code as string) === `TEST_INTEGRITY_${id}`);
        expect(messages, `${category}: ${diff}`).toHaveLength(1);
        for (const message of messages) texts.push(message.text);
      }
      detailsByGroup.set(category, details);
    }

    for (const [category, details] of detailsByGroup) {
      expect(details.size, category).toBe(1);
      for (const detail of details) {
        expect(detail.length, category).toBeGreaterThan(0);
        expect(detail.length, category).toBeLessThanOrEqual(300);
      }
    }

    const ti03Details = groups
      .filter(([id]) => id === "TI03")
      .map(([, category]) => [...(detailsByGroup.get(category) ?? [])][0]);
    expect(new Set(ti03Details).size).toBe(4);

    for (const text of texts) {
      for (const needle of forbidden) expect(text, `"${needle}" in: ${text}`).not.toContain(needle);
    }
  });
});
