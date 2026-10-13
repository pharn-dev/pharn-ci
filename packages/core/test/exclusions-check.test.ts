import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is imported inside each test body, and every input is built there: these tests are written before
// exclusions exist, so nothing that depends on them may run while the file loads.

/** Three added files: src/app.ts (1 of 2 lines covered) and two fully covered files under src/gen/. */
const DIFF = [
  "diff --git a/src/gen/zeta.ts b/src/gen/zeta.ts",
  "new file mode 100644",
  "index 0000000..1111111",
  "--- /dev/null",
  "+++ b/src/gen/zeta.ts",
  "@@ -0,0 +1,3 @@",
  "+export const z1 = 1;",
  "+export const z2 = 2;",
  "+export const z3 = 3;",
  "diff --git a/src/app.ts b/src/app.ts",
  "new file mode 100644",
  "index 0000000..2222222",
  "--- /dev/null",
  "+++ b/src/app.ts",
  "@@ -0,0 +1,2 @@",
  "+export const a = 1;",
  "+export const b = 2;",
  "diff --git a/src/gen/alpha.ts b/src/gen/alpha.ts",
  "new file mode 100644",
  "index 0000000..3333333",
  "--- /dev/null",
  "+++ b/src/gen/alpha.ts",
  "@@ -0,0 +1,3 @@",
  "+export const a1 = 1;",
  "+export const a2 = 2;",
  "+export const a3 = 3;",
  "",
].join("\n");

const LCOV = [
  "SF:src/app.ts",
  "DA:1,1",
  "DA:2,0",
  "end_of_record",
  "SF:src/gen/zeta.ts",
  "DA:1,1",
  "DA:2,1",
  "DA:3,1",
  "end_of_record",
  "SF:src/gen/alpha.ts",
  "DA:1,1",
  "DA:2,1",
  "DA:3,1",
  "end_of_record",
  "",
].join("\n");

type CheckModule = typeof import("../src/check.js");
type CheckInput = Parameters<CheckModule["check"]>[0];

async function run(overrides: Partial<CheckInput> & { exclude?: readonly string[] }) {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage: { text: LCOV, format: "lcov" },
    diff: { text: DIFF },
    repoRoot: "/repo",
    threshold: 80,
    repoFiles: ["AGENTS.md", "src/app.ts", "src/gen/alpha.ts", "src/gen/zeta.ts"],
    ...overrides,
  } as CheckInput;
  return check(input);
}

describe("check(): exclusions", () => {
  it("AC-8: leaves excluded changed files out of every diff coverage count and lists them sorted", async () => {
    const report = await run({ exclude: ["src/gen/**"] });
    expectValidReport(report);
    const dc = report.diffCoverage;
    expect(dc?.coveredLines).toBe(1);
    expect(dc?.coverableLines).toBe(2);
    expect(dc?.percent).toBe(50);
    expect(dc?.files.map((f) => f.path)).toEqual(["src/app.ts"]);
    expect((dc as { excludedFiles?: string[] } | null)?.excludedFiles).toEqual(["src/gen/alpha.ts", "src/gen/zeta.ts"]);
    // Without the exclusion the same change is 7/8 = 87.5% and passes; excluded, it is 50% and fails.
    expect(report.verdict).toBe("fail");
    expect(report.messages.map((m) => m.code)).toContain("DIFF_COVERAGE_BELOW_THRESHOLD");
  });

  it("AC-9: lists unknown and renamed-into files, never deleted or renamed-out-of files", async () => {
    const diff = [
      "diff --git a/gen/unknown.ts b/gen/unknown.ts",
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      "+++ b/gen/unknown.ts",
      "@@ -0,0 +1 @@",
      "+export const u = 1;",
      "diff --git a/gen/deleted.ts b/gen/deleted.ts",
      "deleted file mode 100644",
      "index 2222222..0000000",
      "--- a/gen/deleted.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-export const d = 1;",
      "-export const e = 2;",
      "diff --git a/src/a.ts b/gen/a.ts",
      "similarity index 88%",
      "rename from src/a.ts",
      "rename to gen/a.ts",
      "index 3333333..4444444 100644",
      "--- a/src/a.ts",
      "+++ b/gen/a.ts",
      "@@ -2 +2 @@",
      "-  return 1;",
      "+  return 2;",
      "diff --git a/gen/b.ts b/src/b.ts",
      "similarity index 88%",
      "rename from gen/b.ts",
      "rename to src/b.ts",
      "index 5555555..6666666 100644",
      "--- a/gen/b.ts",
      "+++ b/src/b.ts",
      "@@ -2 +2 @@",
      "-  return 1;",
      "+  return 2;",
      "",
    ].join("\n");
    const lcov = [
      "SF:gen/deleted.ts",
      "DA:1,1",
      "end_of_record",
      "SF:gen/a.ts",
      "DA:2,1",
      "end_of_record",
      "SF:src/b.ts",
      "DA:2,0",
      "end_of_record",
      "",
    ].join("\n");
    const report = await run({
      coverage: { text: lcov, format: "lcov" },
      diff: { text: diff },
      threshold: null,
      exclude: ["gen/**"],
      // The tracked files of this scenario. The default list lacks gen/a.ts and src/b.ts, which the lcov names,
      // so with it no coverage path would match a tracked file. gen/deleted.ts is gone from the repo.
      repoFiles: ["AGENTS.md", "gen/a.ts", "gen/unknown.ts", "src/b.ts"],
    } as Partial<CheckInput>);
    expectValidReport(report);
    const dc = report.diffCoverage as ({ excludedFiles?: string[] } & NonNullable<typeof report.diffCoverage>) | null;
    expect(dc?.excludedFiles).toEqual(["gen/a.ts", "gen/unknown.ts"]);
    expect(dc?.excludedFiles).not.toContain("gen/deleted.ts");
    expect(dc?.excludedFiles).not.toContain("gen/b.ts");
    expect(dc?.files).toEqual([
      { path: "src/b.ts", percent: 0, coveredLines: 0, coverableLines: 1, uncoveredLines: [2] },
    ]);
  });

  it("AC-10: passes with NO_COVERABLE_CHANGES when every changed file with coverable lines is excluded", async () => {
    const report = await run({ threshold: 100, exclude: ["src/**"] });
    expectValidReport(report);
    const dc = report.diffCoverage as ({ excludedFiles?: string[] } & NonNullable<typeof report.diffCoverage>) | null;
    expect(dc?.percent).toBeNull();
    expect(dc?.coverableLines).toBe(0);
    expect(dc?.files).toEqual([]);
    expect(dc?.excludedFiles).toEqual(["src/app.ts", "src/gen/alpha.ts", "src/gen/zeta.ts"]);
    expect(report.messages.map((m) => m.code)).toContain("NO_COVERABLE_CHANGES");
    expect(report.verdict).toBe("pass");
  });

  it("AC-11: has no excludedFiles property when no changed file is excluded", async () => {
    for (const [label, exclude] of [
      ["no patterns", undefined],
      ["an empty pattern list", []],
      ["patterns matching no changed file", ["lib/**", "*.md"]],
    ] as const) {
      const report = await run(exclude === undefined ? {} : { exclude });
      expectValidReport(report);
      expect(report.diffCoverage, label).not.toBeNull();
      expect(Object.hasOwn(report.diffCoverage ?? {}, "excludedFiles"), label).toBe(false);
    }
    // The same inputs with a matching pattern do carry the property, so its absence above is meaningful.
    const matched = await run({ exclude: ["src/gen/zeta.ts"] });
    expect(Object.hasOwn(matched.diffCoverage ?? {}, "excludedFiles")).toBe(true);
  });

  it("AC-12: never changes the agent setup inventory, even when ** excludes every changed file", async () => {
    const { check } = await import("../src/check.js");
    const repoFiles = fixture("golden/files.txt").trim().split("\n");
    const base = {
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles,
    } as CheckInput;
    const without = check(base);
    const withAll = check({ ...base, exclude: ["**"] } as CheckInput);
    expectValidReport(without);
    expectValidReport(withAll);
    expect(withAll.agentSetup.files).toEqual(without.agentSetup.files);
    expect(withAll.agentSetup.files.length).toBeGreaterThan(0);
    // The pattern was applied: every changed, non-deleted file of the golden diff is excluded.
    expect((withAll.diffCoverage as { excludedFiles?: string[] } | null)?.excludedFiles).toEqual([
      "README.md",
      "src/math.ts",
      "src/new.ts",
      "src/utils/new-name.ts",
    ]);
  });

  it("AC-13: throws a ConfigError naming a pattern the validation rejects", async () => {
    const { ConfigError } = await import("../src/config.js");
    for (const pattern of ["{a,b}.ts", "../x", "!src/**", "/src/**"]) {
      let error: unknown;
      try {
        await run({ exclude: ["src/gen/**", pattern] });
      } catch (e) {
        error = e;
      }
      expect(error, pattern).toBeInstanceOf(ConfigError);
      expect((error as Error).message, pattern).toContain(pattern);
    }
  });
});
