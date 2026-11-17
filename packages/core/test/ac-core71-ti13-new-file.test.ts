import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-71 (R2.8): a coverage-ignore comment that reaches one line of a file the change adds is warn; a whole-file or
// range hint there, and any hint added to an existing file, keeps the mode. check() is loaded inside each test body,
// so nothing the change adds runs while the file loads.

type Mode = "block" | "warn";

async function run(diff: string, mode: Mode) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: 80,
    repoFiles: ["package.json", "src/a.ts", "src/a.test.ts", "tools/run.py"],
    testIntegrityMode: { input: mode },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

type Report = Awaited<ReturnType<typeof run>>;
const ti13 = (report: Report) =>
  report.testIntegrity.signals.filter((s) => String(s.id) === "TI13").map((s) => `${s.severity} ${s.path}:${s.line}`);

/** A file the diff adds, with these lines. */
function addFile(path: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "new file mode 100644", "index 0000000..2222222"];
  const body = ["--- /dev/null", `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)];
  return `${[...head, ...body].join("\n")}\n`;
}

/** A modified file with one line added at line 12. */
function addLine(path: string, line: string): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, "@@ -11,0 +12 @@", `+${line}`].join("\n")}\n`;
}

/** A file renamed with edits, one line added at line 12. */
function renameWithLine(from: string, to: string, line: string): string {
  const head = [`diff --git a/${from} b/${to}`, "similarity index 90%", `rename from ${from}`, `rename to ${to}`];
  return `${[...head, `--- a/${from}`, `+++ b/${to}`, "@@ -11,0 +12 @@", `+${line}`].join("\n")}\n`;
}

// Built from parts, so this file never holds a comment the check would read as a marker (it is a test file anyway).
const js = (tool: string, reach: string) => `/* ${tool} ignore ${reach} */`;
const lineComment = (tool: string, reach: string) => `// ${tool} ignore ${reach}`;
const pragma = "# pragma: no cover";

/** Hints that reach one line or one branch: `warn` in a new file in every mode. */
const LINE_LEVEL: string[] = [
  js("istanbul", "next"),
  lineComment("istanbul", "next"),
  js("istanbul", "if"),
  js("istanbul", "else"),
  js("c8", "next"),
  js("v8", "next"),
  `export default ${js("istanbul", "next")} function f() {}`,
];

/** Whole-file and range hints, and a hint with no reach word: the mode's level in a new file too. */
const WHOLE_OR_RANGE: string[] = [
  js("istanbul", "file"),
  js("c8", "file"),
  js("v8", "file"),
  js("v8", "start"),
  js("c8", "stop"),
  js("v8", "next 3"),
  "/* istanbul ignore */",
];

describe("TI13: a hint in a file the change adds (CORE-71)", () => {
  it("must not block: a pragma on a line of a new Python file is warn, in block mode and in warn mode", async () => {
    for (const mode of ["block", "warn"] as const) {
      const report = await run(fixture("test-integrity/TI13/warn-pragma-new-file.diff"), mode);
      expect(ti13(report), mode).toEqual(["warn tools/cli.py:9"]);
      expect(report.testIntegrity.verdict, mode).toBe("warn");
      expect(
        report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI13").map((m) => m.level),
        mode,
      ).toEqual(["warn"]);

      const inline = await run(addFile("tools/new.py", ["def main():", `    return 0  ${pragma}`]), mode);
      expect(ti13(inline), `${mode}: inline pragma`).toEqual(["warn tools/new.py:2"]);
    }
  }, 120_000);

  it("must not block: a line-level JavaScript hint in a new file is warn", async () => {
    expect(ti13(await run(fixture("test-integrity/TI13/warn-istanbul-next-new-file.diff"), "block"))).toEqual([
      "warn src/new.ts:1",
    ]);
    for (const mode of ["block", "warn"] as const) {
      for (const hint of LINE_LEVEL) {
        const report = await run(addFile("src/fresh.ts", ["export const a = 1;", hint, "export const b = 2;"]), mode);
        expect(ti13(report), `${mode}: ${hint}`).toEqual(["warn src/fresh.ts:2"]);
      }
    }
  }, 120_000);

  it("must trigger: a whole-file or range hint in a new file keeps the mode (the whole-file fixtures)", async () => {
    for (const mode of ["block", "warn"] as const) {
      for (const [name, at] of [
        ["block-new-file.diff", "src/new.ts:1"],
        ["block-c8-file-new-file.diff", "src/report.js:1"],
        ["block-v8-start-new-file.diff", "src/format.ts:1"],
      ] as const) {
        const report = await run(fixture(`test-integrity/TI13/${name}`), mode);
        expect(ti13(report), `${mode}: ${name}`).toEqual([`${mode} ${at}`]);
      }
      for (const hint of WHOLE_OR_RANGE) {
        const report = await run(addFile("src/fresh.ts", [hint, "export const a = 1;"]), mode);
        expect(ti13(report), `${mode}: ${hint}`).toEqual([`${mode} src/fresh.ts:1`]);
      }
    }
    const blocked = await run(fixture("test-integrity/TI13/block-new-file.diff"), "block");
    expect(blocked.testIntegrity.verdict).toBe("fail");
  }, 120_000);

  it("must trigger: a hint added to an existing or renamed source file keeps the mode, line-level or not", async () => {
    for (const mode of ["block", "warn"] as const) {
      for (const hint of [lineComment("istanbul", "next"), ...LINE_LEVEL, ...WHOLE_OR_RANGE]) {
        expect(ti13(await run(addLine("src/a.ts", hint), mode)), `${mode}: ${hint}`).toEqual([`${mode} src/a.ts:12`]);
      }
      expect(ti13(await run(addLine("tools/run.py", `    return x  ${pragma}`), mode)), `${mode}: pragma`).toEqual([
        `${mode} tools/run.py:12`,
      ]);
      expect(
        ti13(await run(renameWithLine("src/old.ts", "src/moved.ts", lineComment("istanbul", "next")), mode)),
        `${mode}: renamed`,
      ).toEqual([`${mode} src/moved.ts:12`]);
    }
    const existing = await run(fixture("test-integrity/TI13/block-istanbul-next.diff"), "block");
    expect(ti13(existing)).toEqual(["block src/a.ts:12"]);
    expect(existing.testIntegrity.verdict).toBe("fail");
  }, 120_000);

  it("a new file with a line-level and a whole-file hint gives one warn and one signal at the mode's level", async () => {
    const diff = addFile("src/fresh.ts", [js("istanbul", "file"), "export const a = 1;", lineComment("c8", "next")]);
    expect(ti13(await run(diff, "block"))).toEqual(["block src/fresh.ts:1", "warn src/fresh.ts:3"]);
  }, 120_000);
});
