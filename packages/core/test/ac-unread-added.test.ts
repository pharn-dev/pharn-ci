import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { indexTestFile } from "../src/testIndex/indexTestFile.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { withoutFix } from "./v090-codes.js";

// fix/unparsed-added-test-file: an added test file whose head side cannot be indexed (refused by the test index, dropped,
// missing, no Python index) used to be dropped with no trace, so nothing that reads the added files checked its tests
// and the report did not say so. It is now named in the one TEST_INTEGRITY_INDEX_UNAVAILABLE message, in a sentence of
// its own after the TI02 and TI05 sentence (which is byte-identical to before) and before the TI09 sentence. The message
// stays a warning in every mode; mode off gives none.

const REPO_ROOT = "/home/runner/work/demo/demo";
const DIR = `${FIXTURES}test-integrity/index-unavailable`;
const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";

type Mode = "block" | "warn" | "off";
interface SourceFile {
  path: string;
  text: string;
}
type Side = { files: SourceFile[]; dropped: { path: string; reason: string }[] } | { unavailable: string };

/** The `<logical path>.txt` files under one side of a fixture case. */
function sideFiles(dir: string): SourceFile[] {
  try {
    statSync(dir);
  } catch {
    return [];
  }
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt"))
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const diffOf = (name: string) => readFileSync(join(DIR, name, "change.diff"), "utf8");
/** The kept files of one side of a case, less the paths given (they are dropped in the test). */
const side = (name: string, which: "base" | "head", drop: Record<string, string> = {}): Side => ({
  files: sideFiles(join(DIR, name, which)).filter((file) => drop[file.path] === undefined),
  dropped: Object.entries(drop)
    .map(([path, reason]) => ({ path, reason }))
    .sort((a, b) => (a.path < b.path ? -1 : 1)),
});
/** The `diff --git` sections of a diff whose new path is not in `without`. */
const diffWithout = (text: string, without: string[]) =>
  text
    .split(/(?=^diff --git )/m)
    .filter((section) => !without.some((path) => section.startsWith(`diff --git a/${path} b/${path}\n`)))
    .join("");

function run(input: { diff: string; base: Side; head: Side; mode: Mode; index?: unknown; repoFiles?: string[] }) {
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: input.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: input.repoFiles ?? ["src/cart.ts"],
    testIntegrityMode: { input: input.mode },
    testSources: { base: input.base, head: input.head },
    ...(input.index === undefined ? {} : { pythonTestIndex: input.index }),
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  // fix-hints (H6): every message now carries a `fix`; the pinned literals are unchanged, so they are read without it.
  return { report, messages: withoutFix(report.messages.filter((message) => message.code === CODE)) };
}

const ADDED = (named: string) =>
  `The tests in these added test files could not be read, so they are not checked: ${named}.`;
const COMPARED = (named: string) =>
  `TI02 and TI05 could not compare these touched test files, so they are not checked for removed tests or emptied assertions: ${named}.`;

describe("TEST_INTEGRITY_INDEX_UNAVAILABLE names an added test file whose tests could not be read", () => {
  it.each(["block", "warn"] as const)(
    "added-broken in mode %s: the added file the index refuses is named with syntax-error-heavy, as a warning",
    (mode) => {
      const head = side("added-broken", "head");
      expect(
        "files" in head && indexTestFile("src/new.test.ts", head.files[0]?.text ?? ""),
        "the test index refuses the added file",
      ).toEqual({ parsed: false, reason: "syntax-error-heavy" });
      const { messages } = run({ diff: diffOf("added-broken"), base: side("added-broken", "base"), head, mode });
      expect(messages).toEqual([
        { level: "warn", code: CODE, text: ADDED("`src/new.test.ts` (`syntax-error-heavy`)") },
      ]);
    },
  );

  it("added-broken in mode off: no message", () => {
    const { report, messages } = run({
      diff: diffOf("added-broken"),
      base: side("added-broken", "base"),
      head: side("added-broken", "head"),
      mode: "off",
    });
    expect(messages).toEqual([]);
    expect(report.messages.map((message) => message.code)).toContain("TEST_INTEGRITY_OFF");
  });

  it("added-broken with its head text dropped as too-large: named with too-large", () => {
    const { messages } = run({
      diff: diffOf("added-broken"),
      base: side("added-broken", "base"),
      head: side("added-broken", "head", { "src/new.test.ts": "too-large" }),
      mode: "block",
    });
    expect(messages.map((message) => [message.level, message.text])).toEqual([
      ["warn", ADDED("`src/new.test.ts` (`too-large`)")],
    ]);
  });

  it("added-parseable: an added file the index reads is not named, and its tests are counted", () => {
    const { report, messages } = run({
      diff: diffOf("added-parseable"),
      base: side("added-parseable", "base"),
      head: side("added-parseable", "head"),
      mode: "block",
    });
    expect(messages, "no index-unavailable message").toEqual([]);
    expect(report.testIntegrity.languages).toEqual(["ts"]);
    expect(report.testIntegrity.changes?.totals.added, "its one test is counted as added").toBe(1);
  });

  it("added-six-broken: the first five are named, then `and 1 more`", () => {
    const { messages } = run({
      diff: diffOf("added-six-broken"),
      base: side("added-six-broken", "base"),
      head: side("added-six-broken", "head"),
      mode: "block",
    });
    const named = [1, 2, 3, 4, 5].map((i) => `\`src/n${i}.test.ts\` (\`syntax-error-heavy\`)`).join(", ");
    expect(messages.map((message) => [message.level, message.text])).toEqual([["warn", ADDED(`${named} and 1 more`)]]);
    expect(messages[0]?.text).not.toContain("n6.test.ts");
  });

  it("mixed: the compared sentence (byte-identical to the one without the added file), then the added sentence, then the TI09 sentence", () => {
    const base = side("mixed", "base");
    const head = side("mixed", "head", { "src/a.test.ts": "too-large", "vitest.config.ts": "too-large" });
    const ti09 =
      "TI09 could not read these touched test-config files, so they are not checked for loosened settings: `vitest.config.ts` (`too-large`).";

    // Without the added file, the message is today's: the compared sentence, then the TI09 sentence.
    const without = run({ diff: diffWithout(diffOf("mixed"), ["src/new.test.ts"]), base, head, mode: "block" });
    expect(without.messages.map((message) => [message.level, message.text])).toEqual([
      ["warn", `${COMPARED("`src/a.test.ts` (`too-large`)")} ${ti09}`],
    ]);

    const { messages } = run({ diff: diffOf("mixed"), base, head, mode: "block" });
    expect(messages.map((message) => [message.level, message.text])).toEqual([
      [
        "warn",
        `${COMPARED("`src/a.test.ts` (`too-large`)")} ${ADDED("`src/new.test.ts` (`syntax-error-heavy`)")} ${ti09}`,
      ],
    ]);
    expect(messages[0]?.text.startsWith(`${COMPARED("`src/a.test.ts` (`too-large`)")} `)).toBe(true);
  });

  it.each([
    ["no Python index", undefined, "python-not-found"],
    ["a Python run that timed out", { available: false, reason: "timeout" }, "timeout"],
  ] as const)(
    "added-python with %s: the added .py file is named with the Python reason (nothing was said before)",
    (_, index, reason) => {
      const input = {
        diff: diffOf("added-python"),
        base: side("added-python", "base"),
        head: side("added-python", "head"),
        index,
        repoFiles: ["src/cart.ts", "tests/test_new.py"],
      };
      const { messages } = run({ ...input, mode: "block" });
      expect(messages.map((message) => [message.level, message.text])).toEqual([
        ["warn", ADDED(`\`tests/test_new.py\` (\`${reason}\`)`)],
      ]);
      expect(run({ ...input, mode: "off" }).messages, "mode off adds no message").toEqual([]);
    },
  );

  it("added-python with a Python index that read it: not named", () => {
    const { messages } = run({
      diff: diffOf("added-python"),
      base: side("added-python", "base"),
      head: side("added-python", "head"),
      index: {
        available: true,
        base: [],
        head: [{ path: "tests/test_new.py", result: { parsed: true, syntaxErrors: 0, tests: [], mocks: [] } }],
      },
      mode: "block",
    });
    expect(messages).toEqual([]);
  });

  it("added-python with a Python index that refused it: named with the refusal", () => {
    const { messages } = run({
      diff: diffOf("added-python"),
      base: side("added-python", "base"),
      head: side("added-python", "head"),
      index: {
        available: true,
        base: [],
        head: [{ path: "tests/test_new.py", result: { parsed: false, reason: "syntax-error" } }],
      },
      mode: "block",
    });
    expect(messages.map((message) => message.text)).toEqual([ADDED("`tests/test_new.py` (`syntax-error`)")]);
  });

  it("mixed-python with no Python index: the compared and the added .py file are each named in their sentence; the compared one is unchanged", () => {
    const input = {
      base: side("mixed-python", "base"),
      head: side("mixed-python", "head"),
      mode: "block" as const,
      repoFiles: ["src/cart.ts", "tests/test_c.py", "tests/test_new.py"],
    };
    const without = run({ ...input, diff: diffWithout(diffOf("mixed-python"), ["tests/test_new.py"]) });
    expect(without.messages.map((message) => message.text)).toEqual([
      COMPARED("`tests/test_c.py` (`python-not-found`)"),
    ]);
    const { messages } = run({ ...input, diff: diffOf("mixed-python") });
    expect(messages.map((message) => [message.level, message.text])).toEqual([
      [
        "warn",
        `${COMPARED("`tests/test_c.py` (`python-not-found`)")} ${ADDED("`tests/test_new.py` (`python-not-found`)")}`,
      ],
    ]);
  });

  it("mixed-python with the base side unavailable: the did-not-run sentence alone, an error in mode block, as before", () => {
    const input = {
      base: { unavailable: "git cat-file failed" },
      head: side("mixed-python", "head"),
      mode: "block" as const,
      repoFiles: ["src/cart.ts", "tests/test_c.py", "tests/test_new.py"],
    };
    const notRun =
      "TI02 and TI05 did not run: the text of the touched test files could not be read (`git cat-file failed`), so removed tests and emptied assertions are not checked.";
    for (const diff of [diffOf("mixed-python"), diffWithout(diffOf("mixed-python"), ["tests/test_new.py"])]) {
      const { messages } = run({ ...input, diff });
      expect(messages.map((message) => [message.level, message.text])).toEqual([["error", notRun]]);
    }
  });

  it("added-broken with the head side unavailable and no compared file: nothing is named, as before (ac-blockfc-scope AC-4, ac-ti0205-unavailable AC-12)", () => {
    // No file has text then; the CLI and the Action log the git failure, and an added file cannot hide a weakened
    // existing test, so the per-file `missing` entries a side with no text would give are not reported.
    for (const name of ["added-broken", "added-parseable"]) {
      for (const mode of ["block", "warn"] as const) {
        const { report, messages } = run({
          diff: diffOf(name),
          base: { unavailable: "git cat-file failed" },
          head: { unavailable: "git cat-file failed" },
          mode,
        });
        expect(messages, `${name} ${mode}`).toEqual([]);
        expect(report.status).not.toBe("fail");
      }
    }
  });
});
