import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import type { TextCheckInput } from "./text-coverage.js";

// CORE-69. check() is loaded inside the test body: the AC test is written before the inputs of AC-1, AC-2, AC-3, AC-4,
// AC-5 and AC-8 fail block, so nothing the build changes may run while the file loads. Every input is built here the
// same way as in those ACs' own files. The block run of each input is the control that fails before the build; the
// warn run must keep the same message at level warn.

type Mode = "block" | "warn" | "off";
interface Case {
  name: string;
  code: string;
  input: CheckFields;
}

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

/** A `--unified=0` diff of a modified file: one hunk header and its removed and added lines. */
function modified(path: string, header: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, header, ...lines].join("\n")}\n`;
}
const addOne = (path: string) => modified(path, "@@ -5,0 +6 @@", ["+  expect(total([1])).toBe(1);"]);
const readable = (path: string, base: string, head: string) => ({
  base: { files: [{ path, text: base }], dropped: [] },
  head: { files: [{ path, text: head }], dropped: [] },
});

/** The inputs of AC-1, AC-2, AC-3, AC-4, AC-5 and AC-8. */
function cases(): Case[] {
  const deepLine = `const deep = ${"[".repeat(2000)}${"]".repeat(2000)};`;
  const long = Array.from({ length: 5001 }, (_, i) => `// line ${i + 1}`);
  return [
    {
      name: "AC-1 too-deep",
      code: "TEST_INTEGRITY_INDEX_UNAVAILABLE",
      input: {
        diff: { text: modified("src/deep.test.ts", "@@ -10,0 +11 @@", [`+${deepLine}`]) },
        testSources: readable("src/deep.test.ts", BASE, `${BASE}${deepLine}\n`),
      },
    },
    {
      name: "AC-2 too-large",
      code: "TEST_INTEGRITY_INDEX_UNAVAILABLE",
      input: {
        diff: { text: modified("src/big.test.ts", "@@ -10,0 +11 @@", ["+/* padding */"]) },
        testSources: readable("src/big.test.ts", BASE, `${BASE}/* ${"x".repeat(530_000)} */\n`),
      },
    },
    {
      name: "AC-3 over-file-cap",
      code: "TEST_INTEGRITY_INDEX_UNAVAILABLE",
      input: {
        diff: { text: addOne("src/a.test.ts") },
        testSources: {
          base: { files: [{ path: "src/a.test.ts", text: BASE }], dropped: [] },
          head: { files: [], dropped: [{ path: "src/a.test.ts", reason: "over-file-cap" }] },
        },
      },
    },
    {
      name: "AC-4 python-not-found",
      code: "TEST_INTEGRITY_INDEX_UNAVAILABLE",
      input: {
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
      },
    },
    {
      name: "AC-5 truncated",
      code: "TEST_INTEGRITY_TEXT_TRUNCATED",
      input: {
        diff: {
          text: modified(
            "src/long.test.ts",
            `@@ -10,0 +11,${long.length} @@`,
            long.map((l) => `+${l}`),
          ),
        },
        testSources: readable("src/long.test.ts", BASE, `${BASE}${long.join("\n")}\n`),
      },
    },
    {
      name: "AC-8 base over-file-cap, head too-large",
      code: "TEST_INTEGRITY_INDEX_UNAVAILABLE",
      input: {
        diff: { text: addOne("src/c.test.ts") },
        testSources: {
          base: { files: [], dropped: [{ path: "src/c.test.ts", reason: "over-file-cap" }] },
          head: { files: [], dropped: [{ path: "src/c.test.ts", reason: "too-large" }] },
        },
      },
    },
  ];
}

const REPO_FILES = [
  "src/a.test.ts",
  "src/big.test.ts",
  "src/c.test.ts",
  "src/cart.ts",
  "src/deep.test.ts",
  "src/long.test.ts",
  "tests/test_c.py",
];

/** The check() fields a case sets: the diff, and any field it overrides. */
type CheckFields = Pick<TextCheckInput, "diff"> & Partial<TextCheckInput>;

async function run(input: CheckFields, mode: Mode): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: REPO_FILES,
    testIntegrityMode: { input: mode },
    ...input,
  });
  expectValidReport(report);
  return report;
}

describe("CORE-69: mode warn keeps the new errors as warnings", () => {
  it("AC-9: the inputs of AC-1, AC-2, AC-3, AC-4, AC-5 and AC-8 in mode warn each hold the block message at level warn, no error, and the verdict warn", async () => {
    for (const c of cases()) {
      const block = await run(c.input, "block");
      const blockMessages = block.messages.filter((m) => m.code === c.code);
      expect(blockMessages, `${c.name}: one ${c.code} in block`).toHaveLength(1);
      expect(blockMessages[0]?.level, `${c.name}: the block message is an error`).toBe("error");

      const warn = await run(c.input, "warn");
      const warnMessages = warn.messages.filter((m) => m.code === c.code);
      expect(warnMessages, `${c.name}: one ${c.code} in warn`).toHaveLength(1);
      expect(warnMessages[0]?.text, `${c.name}: the same text as in block`).toBe(blockMessages[0]?.text);
      expect(warnMessages[0]?.level, `${c.name}: level warn`).toBe("warn");
      expect(
        warn.messages.filter((m) => m.level === "error"),
        `${c.name}: no error in warn`,
      ).toEqual([]);
      expect(warn.verdict, `${c.name}: verdict`).toBe("warn");
    }
  });
});
