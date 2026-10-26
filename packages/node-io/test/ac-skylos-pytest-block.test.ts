import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// Skylos nine, part 2: the six pytest cases (five of the nine plus the aliased-skip variant) the signals block. Each
// case's sources are indexed by node-io with the real python3, then check() runs in mode block and the comment is
// rendered. The fixtures, the index and check() are loaded inside each test body, so a missing fixture fails only its
// test. The expected id per case is written here, never read from a fixture. With no python3 of 3.8 or newer on PATH
// the tests fail with that reason, never skip.

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

/** Index the case's sources with the real python3, run check() in mode block, validate the report and render it. */
async function runCase(name: string) {
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
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: readFileSync(`${root}files.txt`, "utf8").trim().split("\n"),
    testSources: sources,
    pythonTestIndex,
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return { report, markdown: renderMarkdown(report) };
}

const BLOCK_CASES: ReadonlyArray<[string, string]> = [
  ["deleted-test", "TI01"],
  ["added-skip", "TI03"],
  ["added-skip-aliased", "TI03"],
  ["emptied-assertion", "TI05"],
  ["deselect-setting", "TI09"],
  ["replaced-test", "TI02"],
];

describe("Skylos nine for pytest: the block cases through check() with the real Python index", () => {
  for (const [name, id] of BLOCK_CASES) {
    it(
      `AC-5: ${name} gives only ${id} at severity block, a failing test-integrity verdict and a bold **${id}** line in the rendered Test integrity section`,
      async () => {
        requirePython();
        const { report, markdown } = await runCase(name);
        const signals = report.testIntegrity.signals;
        expect(signals.length, `${name}: at least one signal`).toBeGreaterThan(0);
        for (const signal of signals) {
          expect([String(signal.id), signal.severity], `${name}: ${signal.detail}`).toEqual([id, "block"]);
        }
        expect(report.testIntegrity.verdict, `${name}: verdict`).toBe("fail");
        expect(
          section(markdown).some((line) => line.includes(`**${id}**`)),
          `${name}: a rendered line with **${id}**`,
        ).toBe(true);
        if (name === "deselect-setting") {
          for (const signal of signals) expect(signal.detail, "the TI09 detail").toContain("testpaths narrowed");
        }
      },
      SLOW,
    );
  }
});
