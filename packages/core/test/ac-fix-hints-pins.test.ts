import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { withoutTi17SchemaEdits } from "./ti17-schema.js";

// fix-hints (H6), AC-12. The shared re-pin helper (packages/core/test/v090-codes.ts) and check() are loaded inside
// each test body: the AC test is written before the build adds them. The tree is read with git against the base
// commit, and the existing test files the increment edits are run in a child vitest. The child's PHARN_TEST_RESULTS
// is removed, so vitest.config.ts never points it at the gate's own results file; its JSON report goes to a temporary
// file.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
// The base commit of the increment; the range it starts ends at the increment's own commit (incrementEnd).
const BASE = "7d88076280ec86435c3f84ad3c6102e272ab64d5";
const MARK = "fix-hints (H6)";
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

interface Helper {
  withoutV090SchemaEdits(text: string): string;
  withoutFix<T>(value: T): T;
}

interface JsonReport {
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests?: number;
  testResults: { name: string; assertionResults: { title: string; status: string; failureMessages: string[] }[] }[];
}

async function helper(): Promise<Helper> {
  const loaded = (await import("./v090-codes.js")) as unknown as Partial<Helper>;
  expect(typeof loaded.withoutV090SchemaEdits, "withoutV090SchemaEdits is exported").toBe("function");
  expect(typeof loaded.withoutFix, "withoutFix is exported").toBe("function");
  return loaded as Helper;
}

/**
 * The end of the increment's range: the commit that added v090-codes.ts once the increment is committed (so a later
 * change to a test file is not read as this increment's), or the working tree (no argument) before that.
 */
function incrementEnd(): string[] {
  const added = git("log", "--diff-filter=A", "--format=%H", "--", "packages/core/test/v090-codes.ts")
    .split("\n")
    .filter((line) => line.length > 0);
  const first = added[added.length - 1];
  return first === undefined ? [] : [first];
}

/** The existing test-directory files the increment changed, as `<status>\t<path>` lines (renames not followed). */
function changedTestFiles(): Array<{ status: string; path: string }> {
  // `packages/*/test/*`, not `packages/*/test`: a wildcard pathspec must match the whole path, so the directory form
  // matched no file at all and the test could never see a re-pinned file.
  return git("diff", "--name-status", "--no-renames", BASE, ...incrementEnd(), "--", "packages/*/test/*")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [status, path] = line.split("\t");
      return { status: status ?? "", path: path ?? "" };
    });
}

/** An added line that marks a test or suite skipped, focused, todo or conditional. */
const ADDED_SKIP = /^\+\s*(?:it|test|describe|suite)\s*\.\s*(?:skip|only|todo|skipIf|runIf)\b/;

describe("existing tests are re-pinned through one shared helper, never weakened", () => {
  it("AC-12: withoutV090SchemaEdits takes out exactly the fix additions, giving the base commit's schema byte for byte, and withoutFix takes the fix objects out of a report", async () => {
    const { withoutV090SchemaEdits, withoutFix } = await helper();
    const schema = read("schema/report.v2.json");
    expect(schema, "the schema has the increment").not.toBe(git("show", `${BASE}:schema/report.v2.json`));
    // ti17-always-true-matcher-2: TI17 edits the schema too, so its helper takes those edits out first.
    expect(withoutV090SchemaEdits(withoutTi17SchemaEdits(schema))).toBe(git("show", `${BASE}:schema/report.v2.json`));

    const { check } = (await import("../src/index.js")) as unknown as { check(input: unknown): unknown };
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    const text = JSON.stringify(report);
    expect(text, "the golden report carries fix").toContain('"fix"');
    expect(`${JSON.stringify(withoutFix(report), null, 2)}\n`).toBe(git("show", `${BASE}:fixtures/golden/report.json`));
    expect(JSON.stringify(report), "withoutFix leaves its input as it was").toBe(text);

    // Only a fix object (string kind and hint) is taken out; any other value under a fix key stays.
    expect(withoutFix({ fix: "a string", nested: [{ a: 1, fix: { kind: "none", hint: "Check the run." } }] })).toEqual({
      fix: "a string",
      nested: [{ a: 1 }],
    });
  });

  it("AC-12: no existing test file is deleted, none gains a skip, focus or todo marker, every edited one names fix-hints (H6), the helper is shared, and every edited test passes in a child run", async () => {
    await helper();
    const changed = changedTestFiles().filter((f) => !/\/ac-fix-hints-[^/]+\.test\.ts$/.test(f.path));
    expect(
      changed.filter((f) => f.status.startsWith("D")).map((f) => f.path),
      "no test file is deleted",
    ).toEqual([]);

    const modified = changed.filter((f) => f.status.startsWith("M")).map((f) => f.path);
    expect(modified.length, "the increment re-pins existing tests").toBeGreaterThan(0);
    for (const path of modified) {
      const added = git("diff", "-U0", BASE, ...incrementEnd(), "--", path)
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
      expect(
        added.filter((line) => ADDED_SKIP.test(line)),
        `${path}: no skip, focus or todo added`,
      ).toEqual([]);
      const lines = read(path).split("\n");
      expect(
        lines.some((l) => /^\s*(\/\/|\/\*|\*)/.test(l) && l.includes(MARK)),
        `${path} names "${MARK}" in a comment`,
      ).toBe(true);
    }
    // The re-pins go through the one shared helper.
    expect(
      modified.some((path) => read(path).includes("v090-codes.js")),
      "an edited test imports v090-codes.js",
    ).toBe(true);

    // The edited test files, run in a child vitest (not the ones that run a child vitest of their own).
    const runnable = modified.filter((path) => path.endsWith(".test.ts") && !read(path).includes("vitest/vitest.mjs"));
    expect(runnable.length).toBeGreaterThan(0);
    const outDir = mkdtempSync(join(tmpdir(), "pharn-ci-fix-hints-pins-"));
    const out = join(outDir, "report.json");
    try {
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.PHARN_TEST_RESULTS;
      const child = spawnSync(
        process.execPath,
        [join(ROOT, "node_modules/vitest/vitest.mjs"), "run", ...runnable, "--reporter=json", `--outputFile=${out}`],
        { cwd: ROOT, env, encoding: "utf8", timeout: 480_000 },
      );
      expect(
        existsSync(out),
        `the child wrote its JSON report (exit ${child.status}): ${child.stderr.slice(-2000)}`,
      ).toBe(true);
      const report = JSON.parse(readFileSync(out, "utf8")) as JsonReport;
      for (const file of runnable) {
        const result = report.testResults.find((r) => r.name.split("\\").join("/").endsWith(file));
        expect(result, `${file} ran`).toBeDefined();
        const tests = result?.assertionResults ?? [];
        expect(tests.length, `${file}: tests collected`).toBeGreaterThan(0);
        for (const t of tests) expect(t.status, `${file} › ${t.title}: ${t.failureMessages.join("\n")}`).toBe("passed");
      }
      expect(report.numFailedTests).toBe(0);
      expect(report.numPendingTests).toBe(0);
      expect(report.numTodoTests ?? 0).toBe(0);
      expect(child.status).toBe(0);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 540_000);
});
