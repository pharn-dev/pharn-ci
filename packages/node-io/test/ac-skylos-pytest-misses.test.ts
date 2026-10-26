import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// Skylos nine, part 2: the two pytest cases the signals miss (hard-coded-answer and the mock.ANY variant of
// always-true-matcher). Each runs through check() in mode block with the real Python index and the renderer without
// throwing, and gives no test-integrity signal. The fixtures, the index and check() are loaded inside each test body.
// With no python3 of 3.8 or newer on PATH the tests fail with that reason, never skip.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const CASES_DIR = `${FIXTURES}skylos-nine-pytest/`;
const REPO_ROOT = "/home/runner/work/demo/demo";
const HEADING = "### 🔍 Test integrity";
const SLOW = 120_000;

/** The python3 on PATH and whether it is 3.8 or newer, decided once while the file loads (no build code runs). */
const PYTHON = (() => {
  const run = spawnSync("python3", ["-c", "import sys; print(sys.version_info >= (3, 8), sys.version.split()[0])"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const [ok, version] = (run.stdout ?? "").trim().split(" ");
  return { ok: run.status === 0 && ok === "True", version: version ?? "", error: run.error?.message ?? "" };
})();

/** Fails the test, with the reason, when no python3 of 3.8 or newer is on PATH. */
function requirePython(): void {
  if (!PYTHON.ok) {
    throw new Error(
      `this test needs python3 3.8 or newer on PATH and found ${PYTHON.version === "" ? `none (${PYTHON.error || "python3 did not run"})` : `python3 ${PYTHON.version}`}`,
    );
  }
}

interface SourceFile {
  path: string;
  text: string;
}

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The lines of the Test integrity section: from its heading to the line before the next `### ` heading. */
function section(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(HEADING);
  if (start === -1) throw new Error("no Test integrity heading");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("### "));
  return [HEADING, ...(end === -1 ? rest : rest.slice(0, end))];
}

const MISSES = ["hard-coded-answer", "always-true-matcher-any"] as const;

describe("Skylos nine for pytest: the two misses run cleanly and give no signal", () => {
  for (const name of MISSES) {
    it(
      `AC-7: ${name} — check() with the real Python index and the renderer do not throw, the report is valid, has no test-integrity signal and the section reads No test-integrity findings (mode: block).`,
      async () => {
        requirePython();
        const root = `${CASES_DIR}${name}/`;
        const diff = readFileSync(`${root}change.diff`, "utf8");
        const sources = {
          base: { files: sideFiles(`${root}base`), dropped: [] },
          head: { files: sideFiles(`${root}head`), dropped: [] },
        };
        const io = (await import("../src/index.js")) as unknown as {
          indexPythonTestSources(sources: unknown): Promise<{ available: boolean } | undefined>;
        };
        const pythonTestIndex = await io.indexPythonTestSources(sources);
        if ([...sources.base.files, ...sources.head.files].some((f) => f.path.endsWith(".py"))) {
          expect(pythonTestIndex?.available, `${name}: the Python index ran`).toBe(true);
        }

        const { check, renderMarkdown } = await import("@pharn-ci/core");
        const input = {
          version: "0.1.0",
          coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
          diff: { text: diff },
          repoRoot: REPO_ROOT,
          threshold: 80,
          repoFiles: readFileSync(`${root}files.txt`, "utf8").trim().split("\n"),
          testSources: sources,
          pythonTestIndex,
          testIntegrityMode: { input: "block" },
        } as unknown as Parameters<typeof check>[0];

        let report: ReturnType<typeof check> | undefined;
        expect(() => {
          report = check(input);
        }).not.toThrow();
        if (report === undefined) throw new Error("check() returned nothing");
        expectValidReport(report);
        expect(report.testIntegrity.signals).toEqual([]);

        let markdown = "";
        expect(() => {
          markdown = renderMarkdown(report as NonNullable<typeof report>);
        }).not.toThrow();
        // The section opens with the no-findings line and names no signal. A case that edits a test body
        // (always-true-matcher-any) also renders the collapsed "Tests changed" table after it, and nothing else.
        const lines = section(markdown).filter((line) => line.trim() !== "");
        expect(lines.slice(0, 2)).toEqual([HEADING, "No test-integrity findings (mode: block)."]);
        expect(
          lines.filter((line) => /\*\*TI\d\d\*\*/.test(line)),
          `${name}: no signal line`,
        ).toEqual([]);
        const rest = lines.slice(2);
        if (rest.length > 0) {
          expect(rest[0], `${name}: only the Tests changed table follows`).toMatch(
            /^<details><summary>Tests changed: \+\d+ −\d+ ~\d+/,
          );
          expect(rest[rest.length - 1]).toBe("</details>");
          expect(
            rest.filter((line) => line.startsWith("<details")),
            `${name}: one details block`,
          ).toHaveLength(1);
        }
      },
      SLOW,
    );
  }
});
