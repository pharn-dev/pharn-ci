import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  TEST_SOURCE_DROP_REASONS,
  type TestSourceDrop,
  type TestSourceFile,
  type TestSources,
} from "../src/testSources.js";
import { FIXTURES } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { check } from "./text-coverage.js";

// Every case directory of fixtures/test-integrity/TI10/ runs through check() in mode block. A case holds change.diff
// and, optionally, base/ and head/ with `<path>.txt` (the text of a test source file) and `<path>.dropped` (a one-line
// file whose text is a drop reason: the file is in `dropped`, not in `files`). A case with neither directory runs with
// no test sources, so only the diff lines are read. A block-* case gives at least one block TI10, a pass-* case none.
// The top-level *.diff files of the directory are older cases read by other tests, not by this one.

const REPO_ROOT = "/home/runner/work/demo/demo";
const REPO_FILES = ["package.json", "src/a.ts", "src/a.test.ts"];
const TI10 = `${FIXTURES}test-integrity/TI10`;

/** Cases that pin a documented limit of docs/LIMITS.md (What TI10 misses), so a later change to either is deliberate. */
const DOCUMENTED_LIMITS: ReadonlySet<string> = new Set([
  // "A coverage upload after `runner &&`": a pipe anywhere counts, so this honest script blocks when the pipe is added.
  "block-pipe-after-and-upload",
  // "A coverage wrapper's own `--exclude`": a flag the wrapper reads still counts, so this honest script blocks.
  "block-coverage-wrapper-exclude",
]);

const cases = readdirSync(TI10, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** One side of a case: the `.txt` files as sources and the `.dropped` files as drops; null when the directory is absent. */
function readSide(dir: string): { files: TestSourceFile[]; dropped: TestSourceDrop[] } | null {
  try {
    statSync(dir);
  } catch {
    return null;
  }
  const names = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => statSync(join(dir, name)).isFile());
  const files: TestSourceFile[] = [];
  const dropped: TestSourceDrop[] = [];
  for (const name of names) {
    if (name.endsWith(".txt")) {
      files.push({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") });
    } else if (name.endsWith(".dropped")) {
      const reason = readFileSync(join(dir, name), "utf8").trim();
      const known = TEST_SOURCE_DROP_REASONS.find((candidate) => candidate === reason);
      expect(known, `${name}: "${reason}" is a drop reason`).toBeDefined();
      if (known !== undefined) dropped.push({ path: name.slice(0, -".dropped".length), reason: known });
    }
  }
  for (const drop of dropped) {
    expect(
      files.some((file) => file.path === drop.path),
      `${drop.path}: a .txt and a .dropped file`,
    ).toBe(false);
  }
  return { files: files.sort(byPath), dropped: dropped.sort(byPath) };
}

/** The sources of a case, or undefined when it has neither a base/ nor a head/ directory. */
function sourcesOf(name: string): TestSources | undefined {
  const base = readSide(join(TI10, name, "base"));
  const head = readSide(join(TI10, name, "head"));
  if (base === null && head === null) return undefined;
  return { base: base ?? { files: [], dropped: [] }, head: head ?? { files: [], dropped: [] } };
}

function run(name: string, sources: TestSources | undefined) {
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: readFileSync(join(TI10, name, "change.diff"), "utf8") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: REPO_FILES,
    testIntegrityMode: { input: "block" },
    ...(sources === undefined ? {} : { testSources: sources }),
  });
  expectValidReport(report);
  return report.testIntegrity.signals.filter((signal) => signal.id === "TI10");
}

/** The head line of the first added line of a diff that holds a `"test"` key, read from the `@@ … +N` header. */
function addedTestLine(diff: string): number {
  let newLine = 0;
  for (const line of diff.split("\n")) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      newLine = Number(header[1]);
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      if (/"test"\s*:/.test(line)) return newLine;
      newLine += 1;
    } else if (line.startsWith(" ")) {
      newLine += 1;
    }
  }
  throw new Error('the diff adds no "test" line');
}

describe("TI10 case fixtures: every case directory through check() in mode block", () => {
  it("holds cases of both kinds, all named block-* or pass-*", () => {
    expect(cases.some((name) => name.startsWith("block-"))).toBe(true);
    expect(cases.some((name) => name.startsWith("pass-"))).toBe(true);
    expect(cases.filter((name) => !/^(block|pass)-/.test(name))).toEqual([]);
  });

  it("names only cases that exist as the documented limits", () => {
    for (const name of DOCUMENTED_LIMITS) expect(cases, name).toContain(name);
  });

  for (const name of cases) {
    it(`${name}${DOCUMENTED_LIMITS.has(name) ? " (a documented limit)" : ""}`, () => {
      const signals = run(name, sourcesOf(name));
      if (name.startsWith("block-")) {
        expect(
          signals.some((signal) => signal.severity === "block"),
          "at least one block TI10",
        ).toBe(true);
      } else {
        expect(signals, "no TI10").toEqual([]);
      }
    });
  }

  it("block-scripts-proto-keys gives exactly one TI10, at the head line of its test key", () => {
    const signals = run("block-scripts-proto-keys", sourcesOf("block-scripts-proto-keys"));
    const head = readFileSync(join(TI10, "block-scripts-proto-keys", "head", "package.json.txt"), "utf8");
    const line = head.split("\n").findIndex((text) => /^\s*"test"\s*:/.test(text)) + 1;
    expect(line).toBeGreaterThan(0);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.line).toBe(line);
    expect(signals[0]?.path).toBe("package.json");
  });

  it("block-or-true-head-dropped: the head is dropped, so the diff line gives the one TI10", () => {
    const name = "block-or-true-head-dropped";
    const sources = sourcesOf(name);
    expect(sources).toBeDefined();
    const head = sources?.head;
    expect(head !== undefined && !("unavailable" in head)).toBe(true);
    if (head === undefined || "unavailable" in head) return;
    expect(
      head.files.map((file) => file.path),
      "the head text is not in files",
    ).not.toContain("package.json");
    expect(head.dropped).toEqual([{ path: "package.json", reason: "too-large" }]);

    const diff = readFileSync(join(TI10, name, "change.diff"), "utf8");
    const signals = run(name, sources);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.line, "the added line of the diff").toBe(addedTestLine(diff));
  });

  it("block-newline-true: an escaped line feed is read on the scripts object, and missed on the diff-line fallback", () => {
    const name = "block-newline-true";
    const onObject = run(name, sourcesOf(name));
    expect(onObject.length, "read from the scripts objects").toBeGreaterThan(0);
    expect(run(name, undefined), "the fallback does not decode the escape").toEqual([]);
  });
});

describe("TI10: a single & loses the status only when it backgrounds the test run or ends the script", () => {
  /** The TI10 signals of a diff that changes `"test": "vitest run",` at line 7 to `"test": "<value>",`. */
  const signalsFor = (value: string) => {
    const diff = [
      "diff --git a/package.json b/package.json",
      "index 1111111..2222222 100644",
      "--- a/package.json",
      "+++ b/package.json",
      "@@ -7 +7 @@",
      '-    "test": "vitest run",',
      `+    "test": ${JSON.stringify(value)},`,
      "",
    ].join("\n");
    const report = check({
      version: "0.1.0",
      coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: REPO_FILES,
      testIntegrityMode: { input: "block" },
    });
    expectValidReport(report);
    return report.testIntegrity.signals.filter((signal) => signal.id === "TI10");
  };

  for (const value of [
    "vitest run & wait",
    "vitest run &",
    "tsc && vitest run & wait",
    "(vitest run) & wait",
    "npx jest & wait",
    "npm run test:unit & wait",
    "node --test & wait",
    "start-server & vitest run &",
    "pytest &",
    "pnpm test & wait",
  ]) {
    it(`"${value}" gives one block TI10 at line 7`, () => {
      const signals = signalsFor(value);
      expect(signals).toHaveLength(1);
      expect(signals[0]?.severity).toBe("block");
      expect(signals[0]?.line).toBe(7);
    });
  }

  for (const value of [
    "start-server & vitest run",
    "node mock-server.js & vitest run",
    "start-server & sleep 2 && vitest run",
    "vite preview --mode test & playwright test",
    "pnpm start & pnpm test",
    "vitest run > log 2>&1",
    "vitest run >&2",
  ]) {
    it(`"${value}" gives no TI10`, () => {
      expect(signalsFor(value)).toEqual([]);
    });
  }
});
