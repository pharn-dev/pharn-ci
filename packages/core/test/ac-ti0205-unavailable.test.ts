import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the core helpers are loaded inside each test body: the AC tests are written before
// TI02, TI05 and TEST_INTEGRITY_INDEX_UNAVAILABLE exist, so nothing that depends on them may run while the file loads.
// Every input is written here. A check that must add no message runs in the same test as one that must add it, so a
// test cannot pass before the message exists.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const PYTHON_DETAIL = "python3 said: SECRET-PYTHON-DETAIL-7f3a";

type Mode = "block" | "warn" | "off";
interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Message {
  code: string;
  level: string;
  text: string;
}
interface Report {
  testIntegrity: { signals: Signal[]; languages: string[] };
  messages: Message[];
}

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

function added(path: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "new file mode 100644", "index 0000000..3333333", "--- /dev/null"];
  return `${[...head, `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

const JS_BASE = [
  'import { expect, it } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'it("adds the prices", () => {',
  "  expect(total([2, 3])).toBe(5);",
  "});",
  "",
  'it("rejects a negative price", () => {',
  '  expect(() => total([-1])).toThrow("negative price");',
  "});",
  "",
].join("\n");
/** JS_BASE with its second test removed. */
const JS_HEAD = `${JS_BASE.split("\n").slice(0, 7).join("\n")}\n`;
/** A diff that removes the second test of JS_BASE from `path`. */
const removal = (path: string) =>
  edit(path, [
    8,
    8,
    ['it("rejects a negative price", () => {', '  expect(() => total([-1])).toThrow("negative price");', "});"],
    [],
  ]);
/** A JS/TS test text with more than ten syntax errors. */
const BROKEN = `${JS_HEAD}\n${Array.from({ length: 30 }, (_, i) => `const = ${i} ) ] }`).join("\n")}\n`;

const PY_BASE =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n\n\ndef test_empty():\n    assert total([]) == 0\n";
const PY_HEAD = "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n";

async function run(input: Record<string, unknown>, mode: Mode): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/a.test.ts", "src/b.test.ts", "src/cart.ts", "tests/test_c.py"],
    testIntegrityMode: { input: mode },
    ...input,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

const unavailableOf = (report: Report) => report.messages.filter((m) => String(m.code) === CODE);
const findingsFor = (report: Report, path: string) =>
  report.testIntegrity.signals.filter((s) => (String(s.id) === "TI02" || String(s.id) === "TI05") && s.path === path);
const noDetail = (report: Report) => {
  for (const m of report.messages) expect(m.text, `${m.code} holds no Python detail`).not.toContain("SECRET-PYTHON");
  expect(JSON.stringify(report)).not.toContain("SECRET-PYTHON");
};

/** Assert exactly one warn TEST_INTEGRITY_INDEX_UNAVAILABLE message naming `path` and `reason`, and no finding for it. */
function expectUnavailable(report: Report, path: string, reason: string) {
  const messages = unavailableOf(report);
  expect(messages, `one ${CODE} message`).toHaveLength(1);
  expect(messages[0]?.level).toBe("warn");
  expect(messages[0]?.text).toContain(path);
  expect(messages[0]?.text).toContain(reason);
  expect(findingsFor(report, path), `no TI02 or TI05 for ${path}`).toEqual([]);
  noDetail(report);
}

describe("TEST_INTEGRITY_INDEX_UNAVAILABLE: a touched test file that could not be compared is named", () => {
  it("AC-12: a modified src/a.test.ts whose head text was dropped as too-large is named with its reason and gives no finding; the same check in mode off adds no message", async () => {
    const input = {
      diff: { text: removal("src/a.test.ts") },
      testSources: {
        base: { files: [{ path: "src/a.test.ts", text: JS_BASE }], dropped: [] },
        head: { files: [], dropped: [{ path: "src/a.test.ts", reason: "too-large" }] },
      },
    };
    expectUnavailable(await run(input, "block"), "src/a.test.ts", "too-large");

    const off = await run(input, "off");
    expect(unavailableOf(off), "mode off adds no message").toEqual([]);
    expect(findingsFor(off, "src/a.test.ts")).toEqual([]);
  });

  it("AC-12: a modified src/b.test.ts whose head text the index refuses as syntax-error-heavy is named with its reason and gives no finding", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as {
      indexTestFile(path: string, text: string): { parsed: boolean; reason?: string };
    };
    expect(core.indexTestFile("src/b.test.ts", BROKEN), "the head text is refused").toEqual({
      parsed: false,
      reason: "syntax-error-heavy",
    });
    const report = await run(
      {
        diff: { text: removal("src/b.test.ts") },
        testSources: {
          base: { files: [{ path: "src/b.test.ts", text: JS_BASE }], dropped: [] },
          head: { files: [{ path: "src/b.test.ts", text: BROKEN }], dropped: [] },
        },
      },
      "block",
    );
    expectUnavailable(report, "src/b.test.ts", "syntax-error-heavy");
  });

  it("AC-12: a modified tests/test_c.py with a Python run unavailable as python-not-found is named with its reason, gives no finding and never shows the run's detail", async () => {
    const report = await run(
      {
        diff: {
          text: edit("tests/test_c.py", [6, 5, ["", "", "def test_empty():", "    assert total([]) == 0"], []]),
        },
        testSources: {
          base: { files: [{ path: "tests/test_c.py", text: PY_BASE }], dropped: [] },
          head: { files: [{ path: "tests/test_c.py", text: PY_HEAD }], dropped: [] },
        },
        pythonTestIndex: { available: false, reason: "python-not-found", detail: PYTHON_DETAIL },
      },
      "block",
    );
    expectUnavailable(report, "tests/test_c.py", "python-not-found");
  });

  it("AC-12: sources unavailable on both sides for a diff that modifies a test file add one message saying TI02 and TI05 did not run and why; for a diff that touches only source files and adds a test file they add none", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as { unavailableTestSources(reason: string): unknown };
    const testSources = core.unavailableTestSources("git cat-file failed");

    const modified = await run({ diff: { text: removal("src/a.test.ts") }, testSources }, "block");
    const messages = unavailableOf(modified);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("warn");
    expect(messages[0]?.text).toContain("TI02");
    expect(messages[0]?.text).toContain("TI05");
    expect(messages[0]?.text, "it says why").toContain("git cat-file failed");
    expect(modified.testIntegrity.signals.filter((s) => ["TI02", "TI05"].includes(String(s.id)))).toEqual([]);
    noDetail(modified);

    const sourceOnly = await run(
      {
        diff: {
          text:
            edit("src/cart.ts", [3, 3, ["  return 0;"], ["  return 1;"]]) +
            added("src/new.test.ts", ['import { it } from "vitest";', 'it("works", () => {});']),
        },
        testSources,
      },
      "block",
    );
    expect(unavailableOf(sourceOnly), "no compared test file, no message").toEqual([]);
  });
});
