import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// ti17-always-true-matcher-2, AC-21. The nine vitest cases (with fixtures/skylos-nine-sources/ where present) and the
// pytest cases (with the -any and -aliased variants, indexed with the real python3) run through check() in mode block,
// as the pinned Skylos tests run them. A case is caught when it has a signal that is not info. The counts are computed
// here and the documents must state them; the expected result (8 of 9 each, only hard-coded-answer missed) is written
// here, never read from a fixture. check() and the index are loaded inside the test body: the AC test is written
// before TI17 exists. With no python3 of 3.8 or newer on PATH the test fails with that reason, never skips.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
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

/** The lines of the markdown section that starts with `heading`, up to the next heading of the same or higher level. */
function sectionOf(text: string, heading: string): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  expect(start, `the heading ${heading}`).toBeGreaterThan(-1);
  const level = (heading.match(/^#+/) ?? [""])[0].length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => {
    const m = /^(#+) /.exec(l);
    return m !== null && (m[1] as string).length <= level;
  });
  return end === -1 ? rest : rest.slice(0, end);
}

/** Lines joined into one text with every run of whitespace as one space, so a re-wrapped sentence still matches. */
const flat = (lines: string[]) => lines.join(" ").replace(/\s+/g, " ");

/** The paragraph (lines up to a blank line) that starts with the given text, flattened. */
function paragraph(text: string, start: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith(start));
  expect(at, `a paragraph starting ${start}`).toBeGreaterThan(-1);
  const rest = lines.slice(at);
  const end = rest.findIndex((l) => l.trim() === "");
  return flat(end === -1 ? rest : rest.slice(0, end));
}

/** The case names of the `- \`case\` — …` bullets in the lines. */
const bulletCases = (lines: string[]) =>
  lines.flatMap((l) => {
    const m = /^- `([a-z-]+)` — /.exec(l);
    return m === null ? [] : [m[1] as string];
  });

describe("Skylos nine with TI17: vitest 8 of 9 and pytest 8 of 9, and the documents say so", () => {
  it(
    "AC-21: the nine vitest and nine pytest cases (with the -any and -aliased variants) through check() catch 8 of 9 each, the only miss of each is hard-coded-answer, and README, PRECISION and LIMITS state exactly those results",
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

      const v = `${vitestCaught.length} of 9`;
      const p = `${pytestCaught.length} of 9`;

      // README: the Skylos paragraphs.
      const readme = readFileSync(`${ROOT}README.md`, "utf8");
      const vitestParagraph = paragraph(readme, "The benchmark for this is Skylos's list");
      expect(vitestParagraph).toContain(`catch **${v}**`);
      expect(vitestParagraph).toContain(`\`always-true-matcher\` by ${ID}`);
      expect(vitestParagraph).toContain(`\`${MISSED}\``);
      expect(vitestParagraph, "no proposal left in the README paragraph").not.toMatch(/proposal/);
      expect(paragraph(readme, "The same nine are reproduced for pytest")).toContain(`catch **${p}**`);

      // PRECISION §3: the always-true-matcher row and the totals line.
      const precision = sectionOf(
        readFileSync(`${ROOT}docs/PRECISION.md`, "utf8"),
        "## 3. Skylos nine: what pharn-ci catches",
      );
      const row = precision.find((l) => l.startsWith("| `always-true-matcher` |"));
      expect(row, "the always-true-matcher row").toBeDefined();
      const cells = (row as string)
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      expect(cells[1], "vitest cell").toBe(`${ID} warn`);
      expect(cells[2], "pytest cell").toContain("TI06 warn");
      expect(cells[2], "pytest cell").toContain(`${ID} warn`);
      expect(cells[3], "notes: the mock.ANY variant is caught by TI17").toMatch(
        new RegExp(`mock\\.ANY[^|]*${ID}|${ID}[^|]*mock\\.ANY`),
      );
      expect(cells[3], "notes: TI17 is no longer planned").not.toMatch(/planned/);
      expect(cells[3], "notes: the mock.ANY variant is no longer missed").not.toMatch(/mock\.ANY`? variant is missed/);
      const hardRow = precision.find((l) => l.startsWith(`| \`${MISSED}\` |`));
      expect(hardRow, "the hard-coded-answer row stays missed").toMatch(/\| missed \| missed \|/);
      expect(flat(precision)).toContain(`In total: vitest ${v}, pytest ${p}.`);

      // LIMITS: the count, the caught list and the missed list of "What test integrity does not catch".
      const limits = sectionOf(readFileSync(`${ROOT}docs/LIMITS.md`, "utf8"), "## What test integrity does not catch");
      expect(flat(limits)).toContain(`The signals of this release catch **${v}**.`);
      const caughtAt = limits.indexOf("Caught:");
      const missedAt = limits.findIndex((l) => l.startsWith("Not caught"));
      const otherAt = limits.findIndex((l) => l.startsWith("Other ways"));
      expect(caughtAt, "the Caught: list").toBeGreaterThan(-1);
      expect(missedAt, "the Not caught list").toBeGreaterThan(caughtAt);
      expect(otherAt, "the list after Not caught").toBeGreaterThan(missedAt);
      expect(bulletCases(limits.slice(caughtAt, missedAt)).sort()).toEqual([...vitestCaught].sort());
      expect(
        limits.slice(caughtAt, missedAt).some((l) => l.startsWith(`- \`always-true-matcher\` — caught by ${ID}`)),
        "the caught list names always-true-matcher by TI17",
      ).toBe(true);
      expect(bulletCases(limits.slice(missedAt, otherAt))).toEqual([MISSED]);
    },
    SLOW,
  );
});
