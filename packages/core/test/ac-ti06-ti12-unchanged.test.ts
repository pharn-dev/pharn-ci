import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the core entry point are loaded inside each test body: the AC tests are written before TI06 and TI12
// exist, so nothing that depends on them may run while the file loads.
//
// What stays: every golden report, with and without sources; every earlier diff-only signal fixture gives the signals
// and messages it gave before (the digest ac-ti0205-regression.test.ts pins); and every TI02 and TI05 case, with its
// base and head text, gives the signals and messages it gave at the base commit 98693cf (a digest taken there), so none
// gains a TI06 or TI12. What changes on purpose: the six Skylos test files AC-19 names now pin 7 of 9 (with
// loosened-assertion caught by TI06 and, since TI09, deselect-setting by TI09), and every one of their test titles is the
// one it had at the base commit apart from the RENAMED_TITLES.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const EARLIER_DIRS = ["TI01", "TI03", "TI04", "TI10", "TI11", "TI13", "TI14"];
const PAIR_DIRS = ["TI02", "TI05"];
/** The TI11 fixtures the signal-precision increment adds; the digest below predates them, so the loop leaves them out. */
const NEW_TI11 = new Set([
  "pass-package-manager-swap.diff",
  "warn-job-retired-tests-moved.diff",
  "block-swap-drops-test.diff",
  "block-job-removed-script-kept.diff",
]);
/** The digest ac-ti0205-regression.test.ts pins for the earlier fixtures without sources. */
const EARLIER_DIGEST = "9851046d2ff16b5c718d655494b44f96ceed0e91f996e689aaa72524174b59f8";
/**
 * sha256 of the JSON list of { fixture, signals, messages } over the TI02 and TI05 cases with their sources, in
 * directory then case order, as check() gave them at the base commit 98693cf.
 */
const PAIR_DIGEST = "2baa284042284c968c42f9f57acc2642ced6dbf743a09958aafab9e852a95a71";
/** The main commit this change was rebased onto (after #94); the Skylos test titles are compared with it. */
const TITLES_BASE = "2fd75371e9e27c80c0df7a81ba3077f2d896cb22";
/** The titles that name the Skylos count, as they were at TITLES_BASE and as they are now. */
const RENAMED_TITLES: ReadonlyMap<string, string> = new Map([
  [
    '"AC-17: emptied-assertion gives a block TI05, replaced-test a block TI02, edited-expected-value a warn TI07, deleted-test and added-skip their TI01 and TI03 as before, and the other four no signal"',
    // TI09 (after TI06) moved deselect-setting to caught as well, so these four titles name 7 of 9 now.
    '"AC-17: emptied-assertion gives a block TI05, replaced-test a block TI02, edited-expected-value a warn TI07, loosened-assertion a warn TI06, deselect-setting a block TI09, deleted-test and added-skip their TI01 and TI03 as before, and the other two no signal"',
  ],
  [
    '"AC-17: docs/LIMITS.md and the README state that 5 of 9 are caught and list those five cases with their signal ids"',
    '"AC-17: docs/LIMITS.md and the README state that 7 of 9 are caught and list those seven cases with their signal ids"',
  ],
  [
    '"AC-4: exactly the five caught cases give a signal, each only its table id, and the other four give none"',
    '"AC-4: exactly the seven caught cases give a signal, each only its table id, and the other two give none"',
  ],
  [
    '"AC-4: the headline — nine cases, 5 caught, 4 expected misses"',
    '"AC-4: the headline — nine cases, 7 caught, 2 expected misses"',
  ],
]);
const NEW_IDS = ["TI06", "TI12"];
const NEW_CODES = ["TEST_INTEGRITY_TI06", "TEST_INTEGRITY_TI12"];

const asFile = (report: unknown) => `${JSON.stringify(report, null, 2)}\n`;
const fixtureLines = (path: string) => fixture(path).trim().split("\n");

interface SourceFile {
  path: string;
  text: string;
}
interface Report {
  testIntegrity: { signals: { id: string }[] };
  messages: { code: string; level: string; text: string }[];
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

/** The exclusion patterns the TI14 fixture that appends an item is judged against: the items it appends. */
function excludeFor(name: string, text: string): string[] {
  if (name !== "TI14/block-exclude-appended.diff") return [];
  return text
    .split("\n")
    .filter((line) => /^\+\s+- /.test(line))
    .map((line) => line.replace(/^\+\s+- /, "").replace(/^["']|["']$/g, ""));
}

function expectNoNewSignal(report: Report, label: string): void {
  expect(
    report.testIntegrity.signals.filter((s) => NEW_IDS.includes(String(s.id))),
    `${label}: no TI06 or TI12`,
  ).toEqual([]);
  expect(
    report.messages.filter((m) => NEW_CODES.includes(String(m.code))),
    `${label}: no TEST_INTEGRITY_TI06 or TEST_INTEGRITY_TI12 message`,
  ).toEqual([]);
}

/** The `it(` and `describe(` titles of a test file, as written in the source (the first argument's literal). */
function titles(text: string): string[] {
  const out: string[] = [];
  const pattern =
    /\b(?:it|describe|test)(?:\.[A-Za-z]+)*(?:\([^()]*\))?\(\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  for (const m of text.matchAll(pattern)) out.push(m[1] as string);
  return out;
}

/** The text of the array literal `const <name> = [ … ]` (or `… : Type = [ … ]`) in `text`. */
function arrayLiteral(text: string, name: string): string {
  const found = new RegExp(`const ${name}\\b[^=]*= \\[`).exec(text);
  expect(found, `const ${name}`).not.toBeNull();
  const open = (found as RegExpExecArray).index + (found as RegExpExecArray)[0].length - 1;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]" && --depth === 0) return text.slice(open, i + 1);
  }
  throw new Error(`const ${name} is not closed`);
}

const SIX = [
  "packages/core/test/ac-ti0205-skylos.test.ts",
  "packages/core/test/ac-skylos-nine-table.test.ts",
  "packages/core/test/ac-v020-skylos-count.test.ts",
  "packages/core/test/ac-skylos-nine-misses.test.ts",
  "packages/core/test/ac-v020-limits.test.ts",
  "packages/core/test/ac-v020-readme.test.ts",
] as const;

describe("TI06 and TI12 change the earlier outputs and tests only where they mean to", () => {
  it("AC-19: the goldens stay byte-identical, the earlier diff-only fixtures and the TI02 and TI05 cases with their sources give what they gave before, and none of them gives a TI06 or TI12", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Record<string, unknown>;
    expect(typeof core.detectTI06, "TI06 exists, so its absence below is the inputs' doing").toBe("function");
    expect(typeof core.detectTI12, "TI12 exists, so its absence below is the inputs' doing").toBe("function");
    const { check } = await import("../src/check.js");
    const { parseConfig } = await import("../src/config.js");
    type Input = Parameters<typeof check>[0];

    // The goldens, built as the test that owns each report.json builds them.
    const exclusionsConfig = parseConfig(fixture("golden-exclusions/ci.yml")) as {
      coverage?: { exclude?: string[]; threshold?: number };
    };
    const golden = (dir: string) => ({
      version: "0.1.0",
      diff: { text: fixture(`${dir}/pr.diff`) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixtureLines(`${dir}/files.txt`),
    });
    const sets: Array<[string, Record<string, unknown>]> = [
      ["golden", { ...golden("golden"), coverage: { text: fixture("golden/coverage.info"), format: "lcov" } }],
      [
        "golden-cobertura",
        { ...golden("golden-cobertura"), coverage: { text: fixture("golden-cobertura/coverage.xml"), format: "auto" } },
      ],
      [
        "golden-exclusions",
        {
          ...golden("golden-exclusions"),
          coverage: { text: fixture("golden-exclusions/coverage.info"), format: "lcov" },
          threshold: exclusionsConfig.coverage?.threshold ?? null,
          exclude: exclusionsConfig.coverage?.exclude ?? [],
        },
      ],
      [
        "golden-multi",
        {
          ...golden("golden-multi"),
          coverage: {
            files: [
              { text: fixture("golden-multi/coverage-a.info"), file: "coverage/a/lcov.info" },
              { text: fixture("golden-multi/coverage-b.info"), file: "coverage/b/lcov.info" },
            ],
            format: "auto",
          },
        },
      ],
    ];
    const withText = {
      base: { files: [{ path: "a.test.ts", text: 'it("a", () => { expect(1).toBe(1); });\n' }], dropped: [] },
      head: { files: [], dropped: [{ path: "c.test.ts", reason: "binary" }] },
    };
    for (const [dir, input] of sets) {
      const committed = fixture(`${dir}/report.json`);
      for (const [label, extra] of [
        ["without sources", {}],
        ["with sources", { testSources: withText }],
      ] as const) {
        const report = check({ ...input, ...extra } as unknown as Input);
        expectValidReport(report);
        expect(asFile(report), `${dir} ${label}: the committed report.json`).toBe(committed);
      }
    }

    // The earlier diff-only fixtures, without sources.
    const earlier: Array<{ fixture: string; signals: unknown[]; messages: unknown[] }> = [];
    for (const dir of EARLIER_DIRS) {
      const names = readdirSync(`${FIXTURES}test-integrity/${dir}`)
        .filter((name) => name.endsWith(".diff") && !(dir === "TI11" && NEW_TI11.has(name)))
        .sort();
      for (const file of names) {
        const name = `${dir}/${file}`;
        const text = fixture(`test-integrity/${name}`);
        const files = `test-integrity/${name.replace(/\.diff$/, ".files.txt")}`;
        const report = check({
          version: "0.1.0",
          coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
          diff: { text },
          repoRoot: REPO_ROOT,
          threshold: 80,
          repoFiles: fixtureLines(existsSync(`${FIXTURES}${files}`) ? files : "test-files-deleted/files.txt"),
          exclude: excludeFor(name, text),
          testIntegrityMode: { input: "block" },
        } as unknown as Input) as unknown as Report;
        expectValidReport(report);
        expectNoNewSignal(report, name);
        earlier.push({ fixture: name, signals: report.testIntegrity.signals, messages: report.messages });
      }
    }
    expect(earlier.length).toBeGreaterThan(100);
    expect(
      createHash("sha256").update(JSON.stringify(earlier)).digest("hex"),
      "the earlier fixtures without sources give what they gave before",
    ).toBe(EARLIER_DIGEST);

    // The TI02 and TI05 cases, with their base and head text.
    const pairs: Array<{ fixture: string; signals: unknown[]; messages: unknown[] }> = [];
    for (const dir of PAIR_DIRS) {
      const names = readdirSync(`${FIXTURES}test-integrity/${dir}`, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      for (const name of names) {
        const root = `${FIXTURES}test-integrity/${dir}/${name}/`;
        const base = sideFiles(`${root}base`);
        const head = sideFiles(`${root}head`);
        const diff = readFileSync(`${root}change.diff`, "utf8");
        const report = check({
          version: "0.1.0",
          coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
          diff: { text: diff },
          repoRoot: REPO_ROOT,
          threshold: 80,
          repoFiles: [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
          testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
          testIntegrityMode: { input: "block" },
        } as unknown as Input) as unknown as Report;
        expectValidReport(report);
        expectNoNewSignal(report, `${dir}/${name}`);
        pairs.push({ fixture: `${dir}/${name}`, signals: report.testIntegrity.signals, messages: report.messages });
      }
    }
    expect(pairs.length).toBeGreaterThan(30);
    expect(
      createHash("sha256").update(JSON.stringify(pairs)).digest("hex"),
      "the TI02 and TI05 cases give what they gave at the base commit",
    ).toBe(PAIR_DIGEST);
  }, 60_000);

  it("AC-19: the six Skylos test files now pin 6 of 9 with loosened-assertion caught by TI06, and keep every test title they had at the base commit but the count", () => {
    // Rebased onto main after TI07 (#94), which caught edited-expected-value first: the count is now 6 of 9, and the
    // titles are compared with that main commit, where only the titles that name the count change, as listed.
    for (const path of SIX) {
      const now = readFileSync(join(ROOT, path), "utf8");
      const before = execFileSync("git", ["show", `${TITLES_BASE}:${path}`], { cwd: ROOT, encoding: "utf8" });
      expect(titles(before).length, `${path}: titles at the base commit`).toBeGreaterThan(0);
      const expected = titles(before).map((title) => RENAMED_TITLES.get(title) ?? title);
      expect(titles(now), `${path}: every it( and describe( title byte-identical`).toEqual(expected);
    }
    const file = (path: (typeof SIX)[number]) => readFileSync(join(ROOT, path), "utf8");

    const ti0205 = file("packages/core/test/ac-ti0205-skylos.test.ts");
    expect(ti0205).toContain('"7 of 9"');
    expect(ti0205).not.toContain('"4 of 9"');
    expect(ti0205).toMatch(/\["loosened-assertion",\s*"TI06"\]/);

    const table = file("packages/core/test/ac-skylos-nine-table.test.ts");
    expect(table).toMatch(/name: "loosened-assertion",\s*signal: "TI06",\s*caught: true/);
    expect(table).not.toMatch(/name: "loosened-assertion",\s*signal: "TI06",\s*caught: false/);
    expect(table).toContain('"7/9"');
    expect(table).not.toContain('"4/9"');

    const count = file("packages/core/test/ac-v020-skylos-count.test.ts");
    expect(count).toContain('"7 of 9"');
    expect(count).not.toContain('"4 of 9"');
    expect(count, "loosened-assertion is run with its sources").toContain('"loosened-assertion"');

    const misses = file("packages/core/test/ac-skylos-nine-misses.test.ts");
    expect(arrayLiteral(misses, "MISSES"), "loosened-assertion leaves the miss list").not.toContain(
      "loosened-assertion",
    );

    const limits = file("packages/core/test/ac-v020-limits.test.ts");
    expect(limits).toContain('"7 of 9"');
    expect(limits).not.toContain('"4 of 9"');
    expect(arrayLiteral(limits, "MISSED_CASES"), "loosened-assertion leaves the missed cases").not.toContain(
      "loosened-assertion",
    );

    const readme = file("packages/core/test/ac-v020-readme.test.ts");
    expect(readme).toContain('"7 of 9"');
    expect(readme).not.toContain('"4 of 9"');
  });
});
