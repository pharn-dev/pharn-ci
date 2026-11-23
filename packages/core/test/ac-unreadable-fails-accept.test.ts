import { describe, expect, it } from "vitest";
import type { Message, Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import type { TextCheckInput } from "./text-coverage.js";

// CORE-69. check(), unavailableTestSources() and acceptTestIntegrity() are loaded inside the test body: the AC test is
// written before the accept label lowers the per-file and truncation errors, so nothing the build changes may run while
// the file loads. The AC-1 and AC-5 inputs are built here the same way as in their own files. The whole-run errors
// (TI02 and TI05, or TI09, did not run) stay errors the label cannot lift, also when one message holds a per-file
// error and a whole-run sentence.

const UNAVAILABLE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const TRUNCATED = "TEST_INTEGRITY_TEXT_TRUNCATED";
const ACCEPTED = "TEST_INTEGRITY_ACCEPTED";
const ACCEPT = { label: "pharn/accepted", by: "Reviewer-1" };

const BASE = [
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
const PY_BASE =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n\n\ndef test_empty():\n    assert total([]) == 0\n";
const PY_HEAD = "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n";

function modified(path: string, header: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, header, ...lines].join("\n")}\n`;
}
const readable = (path: string, base: string, head: string) => ({
  base: { files: [{ path, text: base }], dropped: [] },
  head: { files: [{ path, text: head }], dropped: [] },
});

/** The check() fields a case sets: the diff, and any field it overrides. */
type CheckFields = Pick<TextCheckInput, "diff"> & Partial<TextCheckInput>;

async function run(input: CheckFields): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [
      "src/a.test.ts",
      "src/cart.ts",
      "src/deep.test.ts",
      "src/long.test.ts",
      "tests/test_c.py",
      "vitest.config.ts",
    ],
    testIntegrityMode: { input: "block" },
    ...input,
  });
  expectValidReport(report);
  return report;
}

const one = (report: Report, code: string, name: string): Message => {
  const messages = report.messages.filter((m) => m.code === code);
  expect(messages, `${name}: one ${code}`).toHaveLength(1);
  return messages[0] as Message;
};

describe("CORE-69: the accept label lowers the per-file and truncation errors, never a whole-run one", () => {
  it("AC-16: acceptTestIntegrity lowers the AC-1 and AC-5 errors to warn and adds TEST_INTEGRITY_ACCEPTED; every whole-run TEST_INTEGRITY_INDEX_UNAVAILABLE stays an error and its verdict stays fail", async () => {
    const { acceptTestIntegrity } = await import("../src/acceptLabel.js");
    const { unavailableTestSources } = await import("@pharn-ci/core");
    // Each report is accepted as a copy, so a lowered level can never leak into a report a later case reads.
    const accept = (report: Report) => {
      const accepted = acceptTestIntegrity(structuredClone(report) as never, ACCEPT);
      expectValidReport(accepted);
      return accepted;
    };

    const deepLine = `const deep = ${"[".repeat(2000)}${"]".repeat(2000)};`;
    const ac1 = await run({
      diff: { text: modified("src/deep.test.ts", "@@ -10,0 +11 @@", [`+${deepLine}`]) },
      testSources: readable("src/deep.test.ts", BASE, `${BASE}${deepLine}\n`),
    });
    const long = Array.from({ length: 5001 }, (_, i) => `// line ${i + 1}`);
    const ac5 = await run({
      diff: {
        text: modified(
          "src/long.test.ts",
          `@@ -10,0 +11,${long.length} @@`,
          long.map((l) => `+${l}`),
        ),
      },
      testSources: readable("src/long.test.ts", BASE, `${BASE}${long.join("\n")}\n`),
    });

    // Control: before acceptance both are errors and fail the check.
    expect(one(ac1, UNAVAILABLE, "AC-1").level, "AC-1 before acceptance").toBe("error");
    expect(one(ac5, TRUNCATED, "AC-5").level, "AC-5 before acceptance").toBe("error");
    expect(ac1.verdict).toBe("fail");
    expect(ac5.verdict).toBe("fail");

    for (const [name, report, code] of [
      ["AC-1", ac1, UNAVAILABLE],
      ["AC-5", ac5, TRUNCATED],
    ] as const) {
      const accepted = accept(report);
      expect(one(accepted, code, name).level, `${name} after acceptance`).toBe("warn");
      expect(one(accepted, code, name).text, `${name} keeps its text`).toBe(one(report, code, name).text);
      expect(
        accepted.messages.filter((m) => m.code === ACCEPTED),
        `${name}: ${ACCEPTED}`,
      ).toHaveLength(1);
      expect(accepted.verdict, `${name} verdict after acceptance`).not.toBe("fail");
    }

    const ac4 = await run({
      diff: {
        text: modified("tests/test_c.py", "@@ -6,4 +5,0 @@", [
          "-",
          "-",
          "-def test_empty():",
          "-    assert total([]) == 0",
        ]),
      },
      testSources: readable("tests/test_c.py", PY_BASE, PY_HEAD),
      pythonTestIndex: { available: false, reason: "python-not-found" },
    });
    const bothSides = await run({
      diff: { text: modified("src/a.test.ts", "@@ -5,0 +6 @@", ["+  expect(total([1])).toBe(1);"]) },
      testSources: unavailableTestSources("the base commit is not in the checkout"),
    });
    const config = await run({
      diff: { text: modified("vitest.config.ts", "@@ -3 +3 @@", ["-  test: {},", "+  test: { globals: true },"]) },
      testSources: unavailableTestSources("the base commit is not in the checkout"),
    });
    const configText = one(config, UNAVAILABLE, "TI09").text;
    const ti09At = configText.indexOf("TI09 did not run");
    expect(ti09At, "the config report says TI09 did not run").toBeGreaterThanOrEqual(0);
    const mixed = structuredClone(ac1);
    for (const m of mixed.messages) if (m.code === UNAVAILABLE) m.text = `${m.text} ${configText.slice(ti09At)}`;

    for (const [name, report] of [
      ["AC-4 python-not-found", ac4],
      ["both sides unavailable", bothSides],
      ["TI09 did not run", config],
      ["a per-file error and a whole-run sentence in one message", mixed],
    ] as const) {
      const accepted = accept(report);
      expect(one(accepted, UNAVAILABLE, name).level, `${name} stays an error`).toBe("error");
      expect(accepted.verdict, `${name} verdict stays fail`).toBe("fail");
    }
  });
});
