import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import type { TestSourceDrop, TestSourceDropReason } from "../src/testSources.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-69. check() and HEAD_UNREADABLE_ERROR_REASONS are loaded inside each test body: the AC tests are written before
// the level rule and its list exist, so nothing the build adds may run while the file loads. Each row is one input run
// in modes block, warn and off; the level of the message naming the row's file is compared with the row's expectation.
// Every large input (nested literal, text over the size cap, a diff past 5000 changed lines) is built here.

type Mode = "block" | "warn" | "off";
type Side = { files: { path: string; text: string }[]; dropped: TestSourceDrop[] };
interface Row {
  name: string;
  code: "TEST_INTEGRITY_INDEX_UNAVAILABLE" | "TEST_INTEGRITY_TEXT_TRUNCATED";
  path: string;
  diff: string;
  testSources?: { base: Side; head: Side };
  /** true: error in block, warn in warn, absent in off. false: warn in block, warn in warn, absent in off. */
  errorInBlock: boolean;
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
const DEEP = `${BASE}const deep = ${"[".repeat(2000)}${"]".repeat(2000)};\n`;
const LARGE = `${BASE}/* ${"x".repeat(530_000)} */\n`;
/** BASE followed by more than ten syntax errors. */
const BROKEN = `${BASE}\n${Array.from({ length: 30 }, (_, i) => `const = ${i} ) ] }`).join("\n")}\n`;
const CUT = 5001;

function modified(path: string, header: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, header, ...lines].join("\n")}\n`;
}
function added(path: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "new file mode 100644", "index 0000000..3333333", "--- /dev/null"];
  return `${[...head, `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}
const addOne = (path: string) => modified(path, "@@ -5,0 +6 @@", ["+  expect(total([1])).toBe(1);"]);
const cutLines = (text: (i: number) => string) => Array.from({ length: CUT }, (_, i) => text(i + 1));

const indexed = (path: string): Side => ({ files: [{ path, text: BASE }], dropped: [] });
const text = (path: string, body: string): Side => ({ files: [{ path, text: body }], dropped: [] });
const drop = (path: string, reason: TestSourceDropReason): Side => ({ files: [], dropped: [{ path, reason }] });
const empty = (): Side => ({ files: [], dropped: [] });

type HeadOf = { label: string; side: (path: string) => Side };
const HEAD_TOO_DEEP: HeadOf = { label: "refused too-deep", side: (p) => text(p, DEEP) };
const HEAD_TOO_LARGE_TEXT: HeadOf = { label: "refused too-large", side: (p) => text(p, LARGE) };
const HEAD_TOO_LARGE: HeadOf = { label: "dropped too-large", side: (p) => drop(p, "too-large") };
const HEAD_OVER_FILE_CAP: HeadOf = { label: "dropped over-file-cap", side: (p) => drop(p, "over-file-cap") };
const THREE = [HEAD_TOO_DEEP, HEAD_TOO_LARGE, HEAD_OVER_FILE_CAP];
/** HEAD reasons outside the error list, on a file indexed at the merge base. */
const CONTROLS: HeadOf[] = [
  { label: "refused syntax-error-heavy", side: (p) => text(p, BROKEN) },
  { label: "missing", side: () => empty() },
  { label: "dropped over-total-cap", side: (p) => drop(p, "over-total-cap") },
];
/** A modified file whose diff adds CUT lines, past the 5000-changed-line cut. */
const cutModified = (path: string, line: (i: number) => string) =>
  modified(
    path,
    `@@ -10,0 +11,${CUT} @@`,
    cutLines((i) => `+${line(i)}`),
  );

function rows(): Row[] {
  const out: Row[] = [];
  let n = 0;
  const path = () => `src/r${String(++n).padStart(2, "0")}.test.ts`;
  const modifiedRow = (name: string, base: (p: string) => Side, head: HeadOf, errorInBlock: boolean) => {
    const p = path();
    out.push({
      name: `${name}, head ${head.label}`,
      code: "TEST_INTEGRITY_INDEX_UNAVAILABLE",
      path: p,
      diff: addOne(p),
      testSources: { base: base(p), head: head.side(p) },
      errorInBlock,
    });
  };

  const baseDropped = (reason: TestSourceDropReason) => (p: string) => drop(p, reason);
  for (const head of [HEAD_TOO_DEEP, HEAD_TOO_LARGE_TEXT, HEAD_TOO_LARGE, HEAD_OVER_FILE_CAP]) {
    modifiedRow("a modified file indexed at the merge base", indexed, head, true);
  }
  for (const head of THREE) {
    modifiedRow("a modified file dropped at base as over-file-cap", baseDropped("over-file-cap"), head, true);
  }
  // CORE-351: a side dropped as too-large fails closed against a side with text (here the refused too-deep head) and
  // against an over-file-cap head, but not against a head dropped as too-large too (both out of reach).
  for (const head of THREE) {
    modifiedRow(
      "a modified file dropped at base as too-large",
      baseDropped("too-large"),
      head,
      head !== HEAD_TOO_LARGE,
    );
  }
  // CORE-351: over-total-cap is a budget the pull request can spend, so a drop on either side fails closed.
  for (const head of THREE) {
    modifiedRow("a modified file dropped at base as over-total-cap", baseDropped("over-total-cap"), head, true);
  }
  for (const head of CONTROLS) {
    modifiedRow(
      "control: a modified file indexed at the merge base",
      indexed,
      head,
      head.label === "dropped over-total-cap",
    );
  }
  for (const head of THREE) {
    const p = path();
    out.push({
      name: `an added test file, head ${head.label}`,
      code: "TEST_INTEGRITY_INDEX_UNAVAILABLE",
      path: p,
      diff: added(p, ['import { expect, it } from "vitest";', "/* padding */"]),
      testSources: { base: empty(), head: head.side(p) },
      errorInBlock: false,
    });
  }

  const cutRow = (what: string, path: string, diff: string, errorInBlock: boolean) =>
    out.push({
      name: `a diff cut past 5000 changed lines in ${what}`,
      code: "TEST_INTEGRITY_TEXT_TRUNCATED",
      path,
      diff,
      errorInBlock,
    });
  cutRow(
    "a modified JS test file",
    "src/cut.test.ts",
    cutModified("src/cut.test.ts", (i) => `// line ${i}`),
    true,
  );
  cutRow(
    "a modified Go test file",
    "pkg/cart_test.go",
    cutModified("pkg/cart_test.go", (i) => `// line ${i}`),
    true,
  );
  cutRow(
    "an added test file",
    "src/cutnew.test.ts",
    added(
      "src/cutnew.test.ts",
      cutLines((i) => `// line ${i}`),
    ),
    false,
  );
  cutRow(
    "a source file",
    "src/app.ts",
    cutModified("src/app.ts", (i) => `export const v${i} = ${i};`),
    false,
  );
  return out;
}

async function run(row: Row, mode: Mode): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: row.diff },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [row.path, "src/app.ts", "src/cart.ts"],
    testIntegrityMode: { input: mode },
    ...(row.testSources === undefined ? {} : { testSources: row.testSources }),
  });
  expectValidReport(report);
  return report as Report;
}

const levelFor = (report: Report, row: Row): string | null => {
  const naming = report.messages.filter((m) => m.code === row.code && m.text.includes(row.path));
  expect(naming.length, `at most one ${row.code} naming ${row.path}`).toBeLessThanOrEqual(1);
  return naming[0]?.level ?? null;
};

describe("CORE-69: the level of the unreadable and cut messages, by mode", () => {
  it("AC-15: HEAD_UNREADABLE_ERROR_REASONS is the one list of HEAD reasons that make the per-file form an error", async () => {
    const core = await import("../src/testIntegrityUnreadable.js");
    // CORE-50 (binary-diff-not-blind) appends `binary`, as the list's own doc comment says it would.
    expect(core.HEAD_UNREADABLE_ERROR_REASONS).toEqual(["too-deep", "too-large", "over-file-cap", "binary"]);
  });

  // One test for the whole table, so the rows that already hold today (the warn rows) run in the same test as the
  // rows that must change, and every row's mismatch shows in one diff.
  it("AC-15: each row gives error / warn / absent in block / warn / off for a listed HEAD reason on a file indexed at base or dropped there as over-file-cap and for a cut modified test file, and warn / warn / absent for every other row", async () => {
    const actual: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const row of rows()) {
      const key = `${row.name} (${row.path})`;
      actual[key] = {
        block: levelFor(await run(row, "block"), row),
        warn: levelFor(await run(row, "warn"), row),
        off: levelFor(await run(row, "off"), row),
      };
      expected[key] = { block: row.errorInBlock ? "error" : "warn", warn: "warn", off: null };
    }
    expect(actual).toEqual(expected);
  }, 60_000);
});
