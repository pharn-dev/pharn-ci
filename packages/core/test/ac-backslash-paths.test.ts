import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { readCoverageChunks } from "../src/chunkInputs.js";
import { parseCobertura } from "../src/coverage/cobertura.js";
import { parseLcov } from "../src/coverage/lcov.js";
import { literalBackslashKey, resolveBackslashPaths } from "../src/coverage/match.js";
import { parseUnifiedDiff } from "../src/diff/unified.js";
import { normalizePath } from "../src/paths.js";
import { renderMarkdown } from "../src/render/markdown.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-101: on Linux and macOS a backslash is a legal file-name character. A coverage path with one is read with the
// backslash as part of the name when that names a tracked file, and as a separator (a Windows report) otherwise.

const REPO_ROOT = "/home/runner/work/demo/demo";
const FORMATS = [
  { format: "lcov", file: "coverage.info" },
  { format: "cobertura", file: "coverage.xml" },
] as const;

type Format = (typeof FORMATS)[number]["format"];
type Report = ReturnType<typeof check>;

const lines = (path: string) => fixture(path).trim().split("\n");
const codes = (report: Report) => report.messages.map((message) => message.code);

function runCheck(
  dir: string,
  format: Format,
  options: { threshold?: number | null; text?: string; repoRoot?: string; repoFiles?: string[] } = {},
): Report {
  const file = format === "lcov" ? "coverage.info" : "coverage.xml";
  const report = check({
    version: "0.1.0",
    coverage: { text: options.text ?? fixture(`backslash-paths/${dir}/${file}`), format },
    diff: { text: fixture(`backslash-paths/${dir}/pr.diff`) },
    repoRoot: options.repoRoot ?? REPO_ROOT,
    threshold: options.threshold === undefined ? 80 : options.threshold,
    repoFiles: options.repoFiles ?? lines(`backslash-paths/${dir}/files.txt`),
  });
  expectValidReport(report);
  return report;
}

/** The same check through the CLI and Action route: each file read in chunks and handed to check() parsed. */
async function runCheckParsed(dir: string, format: Format, threshold: number | null = 80): Promise<Report> {
  const file = format === "lcov" ? "coverage.info" : "coverage.xml";
  const text = fixture(`backslash-paths/${dir}/${file}`);
  async function* chunks() {
    for (let i = 0; i < text.length; i += 7) yield text.slice(i, i + 7);
  }
  const { choice, parsed, skipped } = await readCoverageChunks(chunks(), format, {
    repoRoot: REPO_ROOT,
    literalBackslashes: true,
  });
  if (choice.format !== "lcov" && choice.format !== "cobertura") throw new Error(`unexpected ${choice.format}`);
  const report = check({
    version: "0.1.0",
    coverage: { files: [{ parsed, format: choice.format, skipped }], format },
    diff: { text: fixture(`backslash-paths/${dir}/pr.diff`) },
    repoRoot: REPO_ROOT,
    threshold,
    repoFiles: lines(`backslash-paths/${dir}/files.txt`),
  });
  expectValidReport(report);
  return report;
}

const fileRow = (report: Report, path: string) => report.diffCoverage?.files.find((file) => file.path === path);

describe("CORE-101: the diff parser reads a C-quoted name with a backslash", () => {
  it("yields the literal name src/a\\b.js from git's quoted headers", () => {
    const files = parseUnifiedDiff(fixture("backslash-paths/literal/pr.diff"));
    expect(files.map((file) => file.path)).toEqual(["src/a\\b.js", "src/c.js"]);
    expect(files[0]?.addedLines).toEqual([1, 2, 3, 4]);
    const both = parseUnifiedDiff(fixture("backslash-paths/both/pr.diff"));
    expect(both.map((file) => file.path)).toEqual(["src/a/b.js", "src/a\\b.js"]);
  });
});

describe.each(FORMATS)("CORE-101 with a $format report", ({ format }) => {
  it("AC-1: tracked src/a\\b.js named literally: its uncovered added lines count, and a threshold above the result fails", async () => {
    const report = runCheck("literal", format);
    expect(fileRow(report, "src/a\\b.js")).toEqual({
      path: "src/a\\b.js",
      percent: 50,
      coveredLines: 2,
      coverableLines: 4,
      uncoveredLines: [2, 3],
    });
    expect(report.diffCoverage?.coveredLines).toBe(4);
    expect(report.diffCoverage?.coverableLines).toBe(6);
    expect(report.verdict).toBe("fail");
    expect(codes(report)).toContain("DIFF_COVERAGE_BELOW_THRESHOLD");
    // The record matched a tracked file, so nothing is left over as an untracked coverage path.
    expect(codes(report)).not.toContain("COVERAGE_PATHS_PARTIALLY_UNMATCHED");
    expect(report.untrackedCoveragePaths).toBeUndefined();

    // A threshold at or below the result passes.
    expect(runCheck("literal", format, { threshold: 60 }).verdict).toBe("pass");
    // The CLI and Action route (parsed in chunks, settled in check()) gives the same report.
    expect(await runCheckParsed("literal", format)).toEqual(report);
  });

  it("AC-2: tracked src/a.js named src\\a.js (a Windows report) still matches", async () => {
    const report = runCheck("windows", format, { repoRoot: "D:\\a\\demo\\demo" });
    expect(report.diffCoverage?.files).toEqual([
      { path: "src/a.js", percent: 50, coveredLines: 1, coverableLines: 2, uncoveredLines: [2] },
    ]);
    expect(report.verdict).toBe("fail");
    expect(codes(report)).not.toContain("COVERAGE_PATHS_PARTIALLY_UNMATCHED");
    expect(codes(report)).not.toContain("COVERAGE_PATHS_UNMATCHED");
    expect(await runCheckParsed("windows", format)).toEqual(runCheck("windows", format));
  });

  it("AC-3: both src/a\\b.js and src/a/b.js tracked: each record goes to the file its literal path names", async () => {
    const report = runCheck("both", format);
    expect(fileRow(report, "src/a/b.js")).toMatchObject({ coveredLines: 2, coverableLines: 2, uncoveredLines: [] });
    expect(fileRow(report, "src/a\\b.js")).toMatchObject({
      coveredLines: 0,
      coverableLines: 2,
      uncoveredLines: [1, 2],
    });
    expect(report.diffCoverage?.percent).toBe(50);
    expect(report.verdict).toBe("fail");
    expect(codes(report)).not.toContain("COVERAGE_PATHS_PARTIALLY_UNMATCHED");
    expect(await runCheckParsed("both", format)).toEqual(report);
  });

  it("an empty tracked-file list (git failed) reads every backslash as a separator, as before", () => {
    const report = runCheck("both", format, { repoFiles: [] });
    // Both records land on src/a/b.js; the literal file has no coverage, so it is no row of diff coverage.
    expect(fileRow(report, "src/a\\b.js")).toBeUndefined();
    expect(report.diffCoverage?.files).toEqual([
      { path: "src/a/b.js", percent: 100, coveredLines: 2, coverableLines: 2, uncoveredLines: [] },
    ]);
  });
});

describe("CORE-101: absolute paths and the other readings", () => {
  it("an absolute lcov path under the repo root keeps a literal backslash when that names a tracked file", () => {
    const text = fixture("backslash-paths/literal/coverage.info").replace(/^SF:/gm, `SF:${REPO_ROOT}/`);
    const report = runCheck("literal", "lcov", { text });
    expect(fileRow(report, "src/a\\b.js")).toMatchObject({ coveredLines: 2, coverableLines: 4 });
  });

  it("a Windows absolute lcov path under a Windows repo root still matches", () => {
    const text = fixture("backslash-paths/windows/coverage.info").replace("SF:", "SF:C:\\work\\demo\\");
    const report = runCheck("windows", "lcov", { text, repoRoot: "C:\\work\\demo" });
    expect(fileRow(report, "src/a.js")).toMatchObject({ coveredLines: 1, coverableLines: 2 });
    expect(codes(report)).not.toContain("COVERAGE_PATHS_PARTIALLY_UNMATCHED");
  });

  it("the parsers read a backslash as a separator unless asked to keep it, so their public results are unchanged", () => {
    expect([...parseLcov(fixture("backslash-paths/both/coverage.info")).keys()]).toEqual(["src/a/b.js"]);
    expect([...parseCobertura(fixture("backslash-paths/both/coverage.xml"), { repoRoot: REPO_ROOT }).keys()]).toEqual([
      "src/a/b.js",
    ]);
    expect([...parseLcov(fixture("backslash-paths/both/coverage.info"), { literalBackslashes: true }).keys()]).toEqual([
      "src/a/b.js",
      "src/a\\b.js",
    ]);
  });

  it("a literal key is kept only when normalizePath turns it back into the separator key", () => {
    const resolve = (path: string) => normalizePath(path, REPO_ROOT);
    const key = (raw: string) => literalBackslashKey(raw, resolve(raw), resolve);
    expect(key("src/a\\b.js")).toBe("src/a\\b.js");
    expect(key(`${REPO_ROOT}/src/a\\b.js`)).toBe("src/a\\b.js");
    expect(key("src/a.js")).toBe("src/a.js");
    // Reading the backslash literally would change what `..` removes: the separator key stays.
    expect(key("a\\b/../c.js")).toBe("a/c.js");
    // A drive path not tracked under its literal name settles on the drive key, as before.
    expect(normalizePath(key("C:\\work\\a.js"))).toBe("C:/work/a.js");
    // A raw path holding the stand-in character gets no literal key.
    expect(key("src/a\\b\u0000.js")).toBe(resolve("src/a\\b\u0000.js"));
  });

  it("resolveBackslashPaths merges a moved record by the format's rule and leaves a map with nothing to move as it is", () => {
    const map = new Map([
      ["src/a.js", new Map([[1, 2]])],
      ["src\\a.js", new Map([[1, 3]])],
    ]);
    const sum = resolveBackslashPaths(map, new Set(["src/a.js"]), (a, b) => a + b);
    expect([...sum]).toEqual([["src/a.js", new Map([[1, 5]])]]);
    const max = resolveBackslashPaths(map, new Set(["src/a.js"]), Math.max);
    expect([...max]).toEqual([["src/a.js", new Map([[1, 3]])]]);
    // The input is not changed.
    expect(map.get("src/a.js")).toEqual(new Map([[1, 2]]));
    const kept = new Map([["src\\a.js", new Map([[1, 1]])]]);
    expect(resolveBackslashPaths(kept, new Set(["src\\a.js"]), Math.max)).toBe(kept);
  });
});

describe("CORE-101: the comment shows the name with its backslash", () => {
  it("renders src/a\\b.js in a code span with one backslash that escapes nothing", () => {
    const markdown = renderMarkdown(runCheck("literal", "lcov"));
    const row = markdown.split("\n").find((line) => line.startsWith("| `src/a\\b.js` |"));
    expect(row, markdown).toBe("| `src/a\\b.js` | 50% | 2/4 | 2-3 |");
    expect(markdown).not.toContain("a\\\\b.js");
  });

  it("still keeps a backslash before a pipe from opening a table cell", () => {
    const report = runCheck("literal", "lcov");
    const hostile = {
      ...report,
      diffCoverage: report.diffCoverage && {
        ...report.diffCoverage,
        files: report.diffCoverage.files.map((file) =>
          file.path === "src/c.js" ? { ...file, path: "x\\|y\\" } : file,
        ),
      },
    };
    const row = renderMarkdown(hostile)
      .split("\n")
      .find((line) => line.startsWith("| `x"));
    // The run of backslashes before the pipe is doubled and the pipe escaped; the trailing backslash is kept as is.
    expect(row).toBe("| `x\\\\\\|y\\` | 100% | 2/2 |  |");
    // Read as GitHub's table scanner does (a backslash pairs with the next character), the row has its 4 cells.
    expect((row ?? "").replace(/\\[\s\S]/g, "").split("|").length - 1).toBe(5);
  });
});
