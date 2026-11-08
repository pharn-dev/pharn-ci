import { describe, expect, it } from "vitest";
import { dependencyCase } from "./dependencies-helpers.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// fix-hints (H6), AC-7. check() is loaded inside the test body: the AC test is written before the build adds the `fix`
// objects. The test-integrity diff is an existing fixture rewritten in memory, so no file is added under fixtures/.
// The secret-shaped string is assembled at run time, so this file holds no literal a secret scanner matches.

const REPO_ROOT = "/home/runner/work/demo/demo";
const UNIQUE_NAME = "zqxFixHintLeak7731";
const SECRET = ["gh", "p_", "Z9y8X7w6".repeat(4), "Q1r2"].join("");

type Fix = { kind: string; target?: string; hint: string };
type Finding = { id: string; path: string | null; line: number | null; detail?: string; name?: string; fix?: Fix };
type Report = {
  messages: { code: string; text: string; fix?: Fix }[];
  testIntegrity: { signals: Finding[] };
  dependencies?: { signals: Finding[] };
};

async function run(input: unknown): Promise<Report> {
  const { check } = (await import("../src/index.js")) as unknown as { check(input: unknown): Report };
  const report = check(input);
  expectValidReport(report);
  return report;
}

/** Every fix of the report: on messages and on every finding array. */
function fixesOf(report: Report): Fix[] {
  const r = report as unknown as Record<string, { signals?: { fix?: Fix }[]; violations?: { fix?: Fix }[] }>;
  const findings = [
    ...report.testIntegrity.signals,
    ...(r.policy?.violations ?? []),
    ...((r.setupHealth as { stale?: { fix?: Fix }[] } | undefined)?.stale ?? []),
    ...(r.injection?.signals ?? []),
    ...(report.dependencies?.signals ?? []),
  ];
  return [...report.messages, ...findings].flatMap((x) => (x.fix === undefined ? [] : [x.fix]));
}

/** The fix without its target: what two findings of one id must share. */
const withoutTarget = (fix: Fix | undefined) => {
  if (fix === undefined) return undefined;
  const { target: _, ...rest } = fix;
  return rest;
};

/**
 * The TI03 fixture (an `it.skip` added to a test that existed), its test name replaced by the token and the secret,
 * and the same change made to a second test file, so the report has two TI03 findings.
 */
function leakyDiff(): string {
  const base = fixture("test-integrity/TI03/block-it-skip-existing.diff");
  expect(base).toContain("'creates a user'");
  const named = base.replaceAll("'creates a user'", `'creates ${UNIQUE_NAME} with ${SECRET}'`);
  return named + named.replaceAll("src/user.test.ts", "src/account.test.ts");
}

describe("fix hints never carry file text, diff text, test names or package names", { timeout: 120_000 }, () => {
  it("AC-7: a test name and an added line holding a unique token and a secret-shaped string never reach fix.hint or fix.target; two TI03 findings differ in fix only by target", async () => {
    const report = await run({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: leakyDiff() },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [...fixture("test-files-deleted/files.txt").trim().split("\n"), "src/account.test.ts"].sort(),
      testIntegrityMode: { input: "block" },
    });
    const ti03 = report.testIntegrity.signals.filter((s) => s.id === "TI03");
    expect(ti03.map((s) => s.path).sort()).toEqual(["src/account.test.ts", "src/user.test.ts"]);
    for (const s of ti03) expect(s.fix, `${s.path} carries fix`).toBeDefined();
    for (const m of report.messages) expect(m.fix, `${m.code} carries fix`).toBeDefined();

    const fixes = fixesOf(report);
    expect(fixes.length).toBeGreaterThanOrEqual(ti03.length + report.messages.length);
    for (const fix of fixes) {
      for (const leak of [UNIQUE_NAME, SECRET]) {
        expect(fix.hint, `hint ${JSON.stringify(fix)}`).not.toContain(leak);
        expect(fix.target ?? "", `target ${JSON.stringify(fix)}`).not.toContain(leak);
      }
    }
    // Two findings of the same id differ only in target, which is their own path or path:line.
    expect(withoutTarget(ti03[0]?.fix)).toEqual(withoutTarget(ti03[1]?.fix));
    expect(ti03[0]?.fix?.target).not.toBe(ti03[1]?.fix?.target);
  });

  it("AC-7: the names of the packages a change adds never reach fix.hint or fix.target; three D05 findings differ in fix only by target", async () => {
    const report = await run(dependencyCase("d05-manifest"));
    const d05 = (report.dependencies?.signals ?? []).filter((s) => s.id === "D05");
    expect(d05.length).toBe(3);
    const names = d05.map((s) => s.name ?? "").filter((name) => name.length > 0);
    expect(names.length, "the findings name the packages").toBe(3);
    for (const s of d05) expect(s.fix, `${s.path}:${s.line} carries fix`).toBeDefined();
    for (const m of report.messages) expect(m.fix, `${m.code} carries fix`).toBeDefined();

    for (const fix of fixesOf(report)) {
      for (const name of names) {
        expect(fix.hint, `hint ${JSON.stringify(fix)}`).not.toContain(name);
        expect(fix.target ?? "", `target ${JSON.stringify(fix)}`).not.toContain(name);
      }
    }
    const shared = d05.map((s) => withoutTarget(s.fix));
    expect(shared[1]).toEqual(shared[0]);
    expect(shared[2]).toEqual(shared[0]);
    expect(new Set(d05.map((s) => s.fix?.target)).size).toBe(3);
  });
});
