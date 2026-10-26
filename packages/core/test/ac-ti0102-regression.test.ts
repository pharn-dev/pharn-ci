import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// git, check() and the fixtures run inside the test body: the AC test is written before the new TI01 and TI02 rules
// and the rebuilt dist exist. git reads this increment's own change: from the base commit 5860ba4 to the working tree
// before it is committed, then the commit that added this file (CI checks out the full history).
//
// What must stay: no existing test file is edited, deleted or renamed (the snapshot files under test/ included); no
// file under fixtures/golden* or fixtures/test-integrity/ changes; both schemas are byte-identical to the base commit;
// and every existing TI01 and TI02 fixture gives the signals and messages it gave at the base commit (a digest taken
// there, TI01 without sources and TI02 with its base and head text). What must change: the committed action dist,
// rebuilt so it carries the new TI01 and TI02 detail sentences.

const BASE = "5860ba4d26636ff484d2228312ae10e1ae439658";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const SELF = "packages/core/test/ac-ti0102-regression.test.ts";
const DIST = "packages/action/dist/index.js";
const SCHEMAS = ["schema/report.v1.json", "schema/report.v2.json"];
/**
 * sha256 of the JSON list of { fixture, signals, messages } over fixtures/test-integrity/TI01/*.diff (no sources)
 * then fixtures/test-integrity/TI02/* (with sources), in name order, in mode block, as check() gave them on main at
 * f1b252e, the commit this change was rebased onto (it was bc448710… at 5860ba4; #103's Python parity moved it, and this
 * change leaves it as main has it).
 */
const BEFORE_DIGEST = "b3a2b28e114e4158bd253d7531463330a912731a01422d049f0216bf99b2c9c9";
/** The rename hint was dropped in review: a name alone must never soften a TI02 block. */
const HINT = "a new test in the same group has a similar name or body, so it may have been renamed.";
const MOVED =
  "Test file deleted; every test it held is found again, by name and body, in another test file of this change.";

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/** From the base commit to the working tree while this file is not committed, else the commit that added it. */
function changeRange(): string[] {
  const added = git("log", "--diff-filter=A", "--format=%H", "-1", "--", SELF).trim();
  return added === "" ? [BASE] : [`${added}^`, added];
}

function changed(...paths: string[]): Array<{ status: string; path: string }> {
  return git("diff", "--name-status", "--no-renames", ...changeRange(), "--", ...paths)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status: (status ?? "").charAt(0), path: rest.at(-1) ?? "" };
    });
}

interface SourceFile {
  path: string;
  text: string;
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

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
    .sort(byPath);
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

async function existingOutputs(): Promise<string> {
  const { check } = await import("../src/check.js");
  type Input = Parameters<typeof check>[0];
  const out: Array<{ fixture: string; signals: unknown; messages: unknown }> = [];
  const run = (name: string, input: Record<string, unknown>) => {
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      repoRoot: REPO_ROOT,
      threshold: 80,
      testIntegrityMode: { input: "block" },
      ...input,
    } as unknown as Input);
    expectValidReport(report);
    out.push({ fixture: name, signals: report.testIntegrity.signals, messages: report.messages });
  };
  const ti01 = readdirSync(`${FIXTURES}test-integrity/TI01`)
    .filter((n) => n.endsWith(".diff"))
    .sort(byName);
  for (const name of ti01) {
    run(`TI01/${name}`, {
      diff: { text: fixture(`test-integrity/TI01/${name}`) },
      repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    });
  }
  const ti02 = readdirSync(`${FIXTURES}test-integrity/TI02`).sort(byName);
  for (const name of ti02) {
    const root = `${FIXTURES}test-integrity/TI02/${name}/`;
    const base = sideFiles(`${root}base`);
    const head = sideFiles(`${root}head`);
    run(`TI02/${name}`, {
      diff: { text: readFileSync(`${root}change.diff`, "utf8") },
      repoFiles: [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
      testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
    });
  }
  expect(out.length, "the existing TI01 and TI02 fixtures ran").toBeGreaterThan(30);
  return sha256(JSON.stringify(out));
}

describe("TI01 and TI02 precision leave the existing suite, goldens and schemas alone", () => {
  it("AC-14: no existing test is edited, deleted or renamed, no golden or test-integrity fixture changes, both schemas match the base commit, the existing TI01 and TI02 fixtures give their base-commit outputs, and the committed dist is rebuilt with the new rules", async () => {
    const tests = changed("packages").filter((c) => /^packages\/[^/]+\/test\//.test(c.path) && c.status !== "A");
    expect(tests, "no existing test file is edited, deleted or renamed").toEqual([]);

    const fixtures = changed("fixtures").filter(
      (c) => c.path.startsWith("fixtures/golden") || c.path.startsWith("fixtures/test-integrity/"),
    );
    expect(fixtures, "no golden or pinned test-integrity fixture changes").toEqual([]);

    // This change leaves both schemas alone. Read over this change's own range (as the test and fixture checks are), so
    // a later commit on main that versions a schema does not fail this test.
    expect(changed(...SCHEMAS), "neither schema is changed by this change").toEqual([]);

    expect(await existingOutputs(), "the existing TI01 and TI02 fixtures give their base-commit outputs").toBe(
      BEFORE_DIGEST,
    );

    expect(
      changed(DIST).some((c) => c.status === "M"),
      "the committed action dist is rebuilt",
    ).toBe(true);
    const dist = readFileSync(`${ROOT}${DIST}`, "utf8");
    expect(dist, "the rebuilt dist carries no rename hint").not.toContain(HINT);
    expect(dist, "and carries the TI01 moved-tests detail").toContain(MOVED);
  }, 120_000);
});
