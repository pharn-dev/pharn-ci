import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import type { PythonTestIndex } from "../src/testIndex/pythonSides.js";
import type { TestSourceDrop, TestSourceDropReason } from "../src/testSources.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-351 (AC-14). check() is loaded inside the test body: the AC test is written before the build, so nothing the
// build changes may run while the file loads. One modified test file per row, in JavaScript, TypeScript and Python, in
// mode block. The sources hold its text on one side and a drop entry on the other (each reason, each side), or a drop
// entry on both sides, or a `missing` drop on one side. A Python row also gets an index that ran and read every `.py`
// text the sources kept, so only the drop decides. One test for the whole table, so the rows that already hold today
// run beside the rows that must change, and every mismatch shows in one diff.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";

type Side = { files: { path: string; text: string }[]; dropped: TestSourceDrop[] };
type Lang = "js" | "ts" | "py";

const JS_TEXT = [
  'import { expect, it } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'it("adds the prices", () => {',
  "  expect(total([2, 3])).toBe(5);",
  "});",
  "",
].join("\n");
const PY_TEXT = "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n";

const textOf = (lang: Lang) => (lang === "py" ? PY_TEXT : JS_TEXT);
const added = (lang: Lang) => (lang === "py" ? "    assert total([1]) == 1" : "  expect(total([1])).toBe(1);");

function diffOf(path: string, lang: Lang): string {
  return `${[
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -5,0 +6 @@",
    `+${added(lang)}`,
  ].join("\n")}\n`;
}

type SideOf = { kind: "text" } | { kind: "drop"; reason: TestSourceDropReason };
const TEXT: SideOf = { kind: "text" };
const drop = (reason: TestSourceDropReason): SideOf => ({ kind: "drop", reason });

interface Row {
  name: string;
  lang: Lang;
  path: string;
  base: SideOf;
  head: SideOf;
  /** true: the message naming the file is an error and the verdict fail. false: a warning, and the run does not fail. */
  error: boolean;
}

const ONE_SIDED: TestSourceDropReason[] = ["over-file-cap", "over-total-cap", "too-large", "binary", "unsafe-path"];

function rows(): Row[] {
  const out: Row[] = [];
  let n = 0;
  const pathOf = (lang: Lang) => {
    const id = String(++n).padStart(2, "0");
    return lang === "py" ? `tests/test_r${id}.py` : `src/r${id}.test.${lang}`;
  };
  const row = (name: string, lang: Lang, base: SideOf, head: SideOf, error: boolean) =>
    out.push({ name: `${lang}: ${name}`, lang, path: pathOf(lang), base, head, error });
  for (const lang of ["js", "ts", "py"] as const) {
    for (const reason of ONE_SIDED) {
      row(`base dropped as ${reason}, head text`, lang, drop(reason), TEXT, true);
      row(`base text, head dropped as ${reason}`, lang, TEXT, drop(reason), true);
    }
    row("dropped as too-large on both sides", lang, drop("too-large"), drop("too-large"), false);
    row("dropped as binary on both sides", lang, drop("binary"), drop("binary"), false);
    row("base dropped as missing, head text", lang, drop("missing"), TEXT, false);
    row("base text, head dropped as missing", lang, TEXT, drop("missing"), false);
  }
  return out;
}

function sideOf(row: Row, which: SideOf): Side {
  return which.kind === "text"
    ? { files: [{ path: row.path, text: textOf(row.lang) }], dropped: [] }
    : { files: [], dropped: [{ path: row.path, reason: which.reason }] };
}

/** An index that ran and read every `.py` text the sources kept. */
function pythonIndex(base: Side, head: Side): PythonTestIndex {
  const parsed = (path: string) => ({
    path,
    result: { parsed: true as const, syntaxErrors: 0, tests: [], mocks: [] },
  });
  return {
    available: true,
    base: base.files.map((f) => parsed(f.path)),
    head: head.files.map((f) => parsed(f.path)),
  };
}

async function run(row: Row): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const base = sideOf(row, row.base);
  const head = sideOf(row, row.head);
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diffOf(row.path, row.lang) },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [row.path, "src/app.ts", "src/cart.ts"].sort(),
    testIntegrityMode: { input: "block" },
    testSources: { base, head },
    ...(row.lang === "py" ? { pythonTestIndex: pythonIndex(base, head) } : {}),
  });
  expectValidReport(report);
  return report;
}

describe("CORE-351: the level of a modified test file the sources reader dropped, by reason and side, in every language", () => {
  it("AC-14: a test file with text on one side and dropped on the other as over-file-cap, over-total-cap, too-large, binary or unsafe-path is the TEST_INTEGRITY_INDEX_UNAVAILABLE error and fails the run; dropped on both sides as too-large or as binary, or on one side as missing, it is a warning and does not fail the run", async () => {
    const actual: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const row of rows()) {
      const report = await run(row);
      const naming = report.messages.filter((m) => m.code === CODE && m.text.includes(`\`${row.path}\``));
      const key = `${row.name} (${row.path})`;
      actual[key] = { messages: naming.length, level: naming[0]?.level ?? null, fails: report.verdict === "fail" };
      expected[key] = { messages: 1, level: row.error ? "error" : "warn", fails: row.error };
    }
    expect(actual).toEqual(expected);
  }, 60_000);
});
