import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
/** The commit before this increment. */
const BEFORE = "73ed546bc52c926fdf86c6d3ce12f5de86e4d82c";
const REPO_ROOT = "/home/runner/work/demo/demo";
/** The tracked files a fixture runs with when it has no sibling `<name>.files.txt`. */
const DEFAULT_FILES = ["package.json", "src/a.test.ts"];

/** The must-not-trigger cases the criterion names, by fixture. */
const TI10_NAMED = [
  "pass-pre-existing-or-true.diff",
  "pass-unrelated-script.diff",
  "pass-no-test-files.diff",
  "pass-stricter.diff",
  "pass-build-echo.diff",
];
const TI13_NAMED = ["pass-moved.diff", "pass-test-file.diff", "pass-py-istanbul.diff"];

/** The text of one `## `, `### ` or `#### ` section of a markdown file, up to the next heading of any of those levels. */
function sectionOf(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^#{2,4} /.test(line) && line.includes(heading));
  if (start === -1) throw new Error(`no section "${heading}"`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{2,4} /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** The tracked files for a fixture: its sibling `<name>.files.txt` when there is one, else the default list. */
function filesFor(dir: string, name: string): string[] {
  const sibling = new URL(`fixtures/test-integrity/${dir}/${name.replace(/\.diff$/, ".files.txt")}`, ROOT);
  if (!existsSync(sibling)) return DEFAULT_FILES;
  return readFileSync(sibling, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function signalsOf(dir: string, name: string, repoFiles = filesFor(dir, name)) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: fixture(`test-integrity/${dir}/${name}`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles,
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report.testIntegrity.signals.filter((signal) => String(signal.id) === dir);
}

describe("TI10 and TI13: docs, schema and fixtures", () => {
  it("AC-12: the v2 schema names both message codes and the v1 schema is byte-identical to the base commit's", () => {
    const schema = read("schema/report.v2.json");
    expect(schema).toContain("TEST_INTEGRITY_TI10");
    expect(schema).toContain("TEST_INTEGRITY_TI13");
    const before = execFileSync("git", ["show", `${BEFORE}:schema/report.v1.json`], {
      cwd: fileURLToPath(ROOT),
      encoding: "utf8",
    });
    expect(read("schema/report.v1.json")).toBe(before);
  });

  it("AC-12: the changelog, README, limits and threat model name TI10 and TI13", () => {
    // Shipped in 0.2.0; before that release its line sat under Unreleased.
    const shipped =
      read("CHANGELOG.md")
        .split(/^## \[/m)
        .find((p) => p.startsWith("0.2.0]")) ?? "";
    expect(shipped).toContain("TI10");
    expect(shipped).toContain("TI13");

    const readme = read("README.md").split("\n");
    const inputRow = readme.find((line) => line.startsWith("| `test-integrity`")) ?? "";
    expect(inputRow, "the test-integrity input row").toContain("TI10");
    expect(inputRow, "the test-integrity input row").toContain("TI13");
    for (const [code, id] of [
      ["TEST_INTEGRITY_TI10", "TI10"],
      ["TEST_INTEGRITY_TI13", "TI13"],
    ] as const) {
      const row = readme.find((line) => line.startsWith(`| \`${code}\``)) ?? "";
      expect(row, `the ${code} message-table row`).toContain(`${id}:`);
    }

    const limits = read("docs/LIMITS.md");
    const ti10 = sectionOf(limits, "What TI10 misses");
    const ti10Lower = ti10.toLowerCase();
    expect(ti10Lower, "missing context lines").toContain("context");
    expect(ti10Lower, "a script split over lines or with a multi-line value").toMatch(
      /multi-line|split|more than one line|several lines/,
    );
    expect(ti10, "a test key outside scripts").toMatch(/outside[^.]*`?scripts`?/);
    expect(ti10Lower, "an added package.json").toContain("added");
    expect(ti10Lower, "a deleted package.json").toContain("deleted");
    expect(ti10, "package.json").toContain("package.json");
    expect(ti10Lower, "the unnamed weakening forms").toMatch(
      /other (weakening )?(forms|ways)|unnamed|not (named|caught|recogni[sz]ed|detected|listed)|--bail|--silent|--if-present/,
    );
    expect(ti10, "the kept-text caps").toMatch(/5[ ,]?000|\b400\b/);

    const ti13 = sectionOf(limits, "What TI13 misses");
    const ti13Lower = ti13.toLowerCase();
    expect(ti13, "other tools' markers").toMatch(/node:coverage|no branch|exclude_lines/);
    expect(ti13Lower, "markers in test files").toContain("test file");
    expect(ti13, "*.test.mts counted as source").toContain(".test.mts");
    expect(ti13, "*.test.cts counted as source").toContain(".test.cts");
    expect(ti13Lower, "a marker inside a string").toContain("string");
    expect(ti13Lower, "a block comment's later line").toContain("block comment");
    expect(ti13, "the kept-text caps").toMatch(/5[ ,]?000|\b400\b/);

    const threat = read("docs/THREAT-MODEL.md");
    const paragraph = threat.split(/\n\s*\n/).find((p) => p.includes("TI10") && p.includes("TI13")) ?? "";
    expect(paragraph, "a threat-model item names TI10 and TI13").not.toBe("");
    expect(paragraph.toLowerCase(), "the diff reader keeps the text of source files").toContain("source");
    expect(paragraph, "the diff reader keeps the text of package.json").toContain("package.json");
    expect(paragraph.toLowerCase(), "kept line text").toMatch(/kept|text/);
    expect(paragraph.toLowerCase(), "fixed-sentence details").toContain("fixed");
  });

  it("AC-12: at least five must-trigger and five must-not-trigger diffs per id, the named cases among them, and they behave", async () => {
    for (const [dir, named] of [
      ["TI10", TI10_NAMED],
      ["TI13", TI13_NAMED],
    ] as const) {
      const folder = new URL(`fixtures/test-integrity/${dir}/`, ROOT);
      expect(existsSync(folder), dir).toBe(true);
      const listed = readdirSync(folder)
        .filter((n) => n.endsWith(".diff"))
        .sort();
      for (const name of named) expect(listed, `${dir}/${name}`).toContain(name);
      expect(listed.filter((n) => n.startsWith("block-")).length, `${dir} must-trigger`).toBeGreaterThanOrEqual(5);
      expect(listed.filter((n) => n.startsWith("pass-")).length, `${dir} must-not-trigger`).toBeGreaterThanOrEqual(5);

      for (const name of listed) {
        const signals = await signalsOf(dir, name);
        const label = `${dir}/${name}`;
        if (name.startsWith("pass-")) expect(signals, label).toEqual([]);
        else if (name.startsWith("block-")) {
          expect(signals.length, label).toBeGreaterThan(0);
          expect(
            signals.some((s) => s.severity === "block"),
            label,
          ).toBe(true);
        }
      }
    }

    // The no-test-files case passes because its tracked files hold no test file: with a test file it fires.
    expect(existsSync(new URL("fixtures/test-integrity/TI10/pass-no-test-files.files.txt", ROOT))).toBe(true);
    const withTests = await signalsOf("TI10", "pass-no-test-files.diff", DEFAULT_FILES);
    expect(withTests.length).toBeGreaterThan(0);
  });
});
