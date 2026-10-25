import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// check(), renderMarkdown() and main() are loaded inside each test body: the AC tests are written before TI14 and
// TI11 exist, so nothing the build adds may run while the file loads.

const ROOT = new URL("../../../", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(`fixtures/${path}`, ROOT), "utf8");
const REPO_ROOT = "/home/runner/work/demo/demo";
const SHA = "1111111111111111111111111111111111111111";
const HEADING = "### 🔍 Test integrity";

const LOWERING = [
  "diff --git a/.pharn/ci.yml b/.pharn/ci.yml",
  "index 1111111..2222222 100644",
  "--- a/.pharn/ci.yml",
  "+++ b/.pharn/ci.yml",
  "@@ -3 +3 @@",
  "-  threshold: 80",
  "+  threshold: 70",
  "",
].join("\n");

/** The lines of the Test integrity section: from its heading to the line before the next `### ` heading. */
function section(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(HEADING);
  if (start === -1) throw new Error("no Test integrity heading");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("### "));
  return [HEADING, ...(end === -1 ? rest : rest.slice(0, end))];
}

function fakeRepo(diff: string) {
  const out: string[] = [];
  const err: string[] = [];
  const contents = new Map([[resolve(REPO_ROOT, "coverage/lcov.info"), fixture("test-files-deleted/coverage.info")]]);
  const deps = {
    cwd: REPO_ROOT,
    git: async (args: string[]) => {
      if (args.includes("ls-files")) {
        const paths = fixture("test-files-deleted/files.txt").trim().split("\n");
        return args.includes("-z") ? `${paths.join("\0")}\0` : `${paths.join("\n")}\n`;
      }
      if (args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
      if (args.includes("diff")) return diff;
      return `${SHA}\n`;
    },
    readFile: async (path: string) => contents.get(path) ?? null,
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
  };
  return { deps, stdout: () => out.join("") };
}

describe("TI14 and TI11 in the PR comment and the CLI", () => {
  it("AC-13: the section lists each signal with path:line, a hint per id, the empty state stays, and the CLI JSON holds the signal", async () => {
    const { check, renderMarkdown } = await import("@pharn-ci/core");

    const base = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    expectValidReport(base);
    expect(base.testIntegrity.signals).toEqual([]);
    expect(section(renderMarkdown(base))).toEqual([HEADING, "", "No test-integrity findings (mode: warn).", ""]);

    const synthetic = {
      ...base,
      testIntegrity: {
        ...base.testIntegrity,
        signals: [
          { id: "TI11", severity: "block", path: ".github/workflows/ci.yml", line: 14, detail: "detail-ti11-block" },
          { id: "TI11", severity: "warn", path: ".github/workflows/x.yml", line: null, detail: "detail-ti11-warn" },
          { id: "TI14", severity: "block", path: ".pharn/ci.yml", line: 3, detail: "detail-ti14-block" },
          { id: "TI14", severity: "info", path: "config/pharn.yml", line: null, detail: "detail-ti14-info" },
        ],
      },
    } as typeof base;
    expectValidReport(synthetic);

    const markdown = renderMarkdown(synthetic);
    const lines = section(markdown);
    const expectations: Array<[string, string, string]> = [
      ["`.github/workflows/ci.yml:14`", "TI11", "detail-ti11-block"],
      ["`.github/workflows/x.yml`", "TI11", "detail-ti11-warn"],
      ["`.pharn/ci.yml:3`", "TI14", "detail-ti14-block"],
      ["`config/pharn.yml`", "TI14", "detail-ti14-info"],
    ];
    const hints = new Set<string>();
    for (const [location, id, detail] of expectations) {
      const at = lines.findIndex((line) => line.includes(location));
      expect(at, location).toBeGreaterThan(-1);
      expect(lines[at], location).toContain(`**${id}**`);
      expect(lines[at], location).toContain(detail);
      expect(lines[at + 1]?.startsWith("  - Hint: "), location).toBe(true);
      hints.add(`${id}:${lines[at + 1]}`);
    }
    // One hint text per id, shared by its findings, and none mentions an accept label.
    expect(hints.size).toBe(2);
    for (const hint of hints) expect(hint.toLowerCase()).not.toContain("accept");

    // The Messages hints for the two new codes.
    const withMessages = {
      ...synthetic,
      messages: [
        { level: "error", code: "TEST_INTEGRITY_TI11", text: "This change weakens a workflow." },
        { level: "error", code: "TEST_INTEGRITY_TI14", text: "This change loosens the config." },
      ],
    } as typeof base;
    expectValidReport(withMessages);
    const all = renderMarkdown(withMessages).split("\n");
    for (const code of ["TEST_INTEGRITY_TI11", "TEST_INTEGRITY_TI14"]) {
      const at = all.findIndex((line) => line.includes(`\`${code}\``));
      expect(at, code).toBeGreaterThan(-1);
      expect(all[at + 1]?.startsWith("  - Hint: "), code).toBe(true);
      expect((all[at + 1] ?? "").toLowerCase(), code).not.toContain("accept");
    }

    // The CLI JSON on a threshold-lowering diff holds the TI14 signal.
    const { main } = await import("../src/main.js");
    const repo = fakeRepo(LOWERING);
    const code = await main(
      ["check", "--coverage", "coverage/lcov.info", "--format", "json", "--test-integrity", "block"],
      repo.deps as never,
    );
    expect(code).not.toBe(2);
    const report = JSON.parse(repo.stdout());
    expectValidReport(report);
    const signals = report.testIntegrity.signals as Array<{ id: string; path: string; severity: string; line: number }>;
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ id: "TI14", path: ".pharn/ci.yml", severity: "block", line: 3 });
  });
});
