import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// ti17-always-true-matcher-2, AC-21. The nine vitest cases (with fixtures/skylos-nine-sources/ where present) and the
// pytest cases (with the -any and -aliased variants, indexed with the real python3) run through check() in mode block,
// as the pinned Skylos tests run them. A case is caught when it has a signal that is not info. The expected result
// (8 of 9 each, only hard-coded-answer missed) is written here, never read from a fixture. check() and the index are
// loaded inside the test body: the AC test is written before TI17 exists. With no python3 of 3.8 or newer on PATH the
// test fails with that reason, never skips. (CORE-133: the check that README, PRECISION and LIMITS state these
// results, and the CORE-129 LIMITS sentence pin, moved out.)

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const SLOW = 300_000;
const MISSED = "hard-coded-answer";
const ID = ["TI", "17"].join("");

const NINE = [
  "deleted-test",
  "added-skip",
  "emptied-assertion",
  "deselect-setting",
  "hard-coded-answer",
  "always-true-matcher",
  "replaced-test",
  "loosened-assertion",
  "edited-expected-value",
] as const;
const PYTEST_VARIANTS = ["added-skip-aliased", "always-true-matcher-any"] as const;

const PYTHON = (() => {
  const run = spawnSync("python3", ["-c", "import sys; print(sys.version_info >= (3, 8), sys.version.split()[0])"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const [ok, version] = (run.stdout ?? "").trim().split(" ");
  return { ok: run.status === 0 && ok === "True", version: version ?? "", error: run.error?.message ?? "" };
})();

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
interface Signal {
  id: string;
  severity: string;
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

const sourcesAt = (dir: string) => {
  const base = sideFiles(`${dir}/base`);
  const head = sideFiles(`${dir}/head`);
  return base.length + head.length === 0
    ? undefined
    : { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } };
};

async function signalsOf(caseDir: string, sourcesDir: string, python: boolean): Promise<Signal[]> {
  const sources = sourcesAt(sourcesDir);
  let extra: Record<string, unknown> = sources === undefined ? {} : { testSources: sources };
  if (python && sources !== undefined) {
    const io = (await import("../src/index.js")) as unknown as {
      indexPythonTestSources(sources: unknown): Promise<{ available: boolean } | undefined>;
    };
    const pythonTestIndex = await io.indexPythonTestSources(sources);
    if ([...sources.base.files, ...sources.head.files].some((f) => f.path.endsWith(".py"))) {
      expect(pythonTestIndex?.available, `${caseDir}: the Python index ran`).toBe(true);
    }
    extra = { ...extra, pythonTestIndex };
  }
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: readFileSync(`${caseDir}/change.diff`, "utf8") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: readFileSync(`${caseDir}/files.txt`, "utf8").trim().split("\n"),
    testIntegrityMode: { input: "block" },
    ...extra,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report.testIntegrity.signals as unknown as Signal[];
}

const caught = (signals: Signal[]) => signals.some((s) => s.severity !== "info");

describe("Skylos nine with TI17: vitest 8 of 9 and pytest 8 of 9", () => {
  it(
    "AC-21: the nine vitest and nine pytest cases (with the -any and -aliased variants) through check() catch 8 of 9 each, and the only miss of each is hard-coded-answer",
    async () => {
      requirePython();
      const vitestCaught: string[] = [];
      const vitestSignals = new Map<string, Signal[]>();
      for (const name of NINE) {
        const signals = await signalsOf(
          `${FIXTURES}skylos-nine/${name}`,
          `${FIXTURES}skylos-nine-sources/${name}`,
          false,
        );
        vitestSignals.set(name, signals);
        if (caught(signals)) vitestCaught.push(name);
      }
      const pytestCaught: string[] = [];
      const pytestSignals = new Map<string, Signal[]>();
      for (const name of [...NINE, ...PYTEST_VARIANTS]) {
        const dir = `${FIXTURES}skylos-nine-pytest/${name}`;
        const signals = await signalsOf(dir, dir, true);
        pytestSignals.set(name, signals);
        if (caught(signals) && (NINE as readonly string[]).includes(name)) pytestCaught.push(name);
      }

      expect(vitestCaught.length, `vitest caught: ${vitestCaught.join(", ")}`).toBe(8);
      expect(NINE.filter((n) => !vitestCaught.includes(n))).toEqual([MISSED]);
      expect(pytestCaught.length, `pytest caught: ${pytestCaught.join(", ")}`).toBe(8);
      expect(NINE.filter((n) => !pytestCaught.includes(n))).toEqual([MISSED]);
      for (const variant of PYTEST_VARIANTS) {
        expect(caught(pytestSignals.get(variant) ?? []), `pytest ${variant} is caught`).toBe(true);
      }
      const ids = (signals: Signal[] | undefined) =>
        [...new Set((signals ?? []).filter((s) => s.severity !== "info").map((s) => `${s.id} ${s.severity}`))].sort();
      expect(ids(vitestSignals.get("always-true-matcher")), "vitest always-true-matcher").toEqual([`${ID} warn`]);
      expect(ids(pytestSignals.get("always-true-matcher")), "pytest always-true-matcher").toEqual([
        "TI06 warn",
        `${ID} warn`,
      ]);
      expect(ids(pytestSignals.get("always-true-matcher-any")), "pytest always-true-matcher-any").toEqual([
        `${ID} warn`,
      ]);
    },
    SLOW,
  );
});
