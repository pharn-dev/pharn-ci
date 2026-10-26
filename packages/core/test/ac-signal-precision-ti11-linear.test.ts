import { describe, expect, it } from "vitest";
import { measureGrowth } from "./growth.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body. The diffs are generated here: N removed job headers, each followed by a
// removed runs-on line and a removed `run: pnpm run test:N` line, a package.json hunk that removes every test:N script,
// and a renamed test file; the keyed comparison must stay linear in that input, and the removed jobs still block. The
// host is loaded, so the timing compares this thread's CPU time over samples of many runs (measureGrowth, growth.ts),
// never an absolute budget.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CI = ".github/workflows/ci.yml";
const TEST_STEP = "A step that runs tests was removed from a workflow.";
const SMALL = 5000;
const LARGE = 4 * SMALL;

function removal(path: string, start: number, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, `@@ -${start},${lines.length} +${start - 1},0 @@`, ...lines.map((l) => `-${l}`)].join("\n")}\n`;
}

/** The moved-job change with `jobs` jobs. */
function movedJobs(jobs: number): string {
  const rename = `${[
    "diff --git a/src/adapter/old/handler.test.ts b/src/adapter/new/handler.test.ts",
    "similarity index 100%",
    "rename from src/adapter/old/handler.test.ts",
    "rename to src/adapter/new/handler.test.ts",
  ].join("\n")}\n`;
  const scripts: string[] = [];
  const workflow: string[] = [];
  for (let n = 1; n <= jobs; n++) {
    scripts.push(`    "test:${n}": "vitest run --project p${n}",`);
    workflow.push(`  job${n}:`, "    runs-on: ubuntu-latest", `    run: pnpm run test:${n}`);
  }
  return rename + removal("package.json", 10, scripts) + removal(CI, 20, workflow);
}

describe("TI11: the keyed comparison is linear", () => {
  it("AC-4: 5000 and 20000 removed jobs with their scripts and a renamed test file each give one block TI11 test-step finding, and the larger input takes less than eight times as long", async () => {
    const { check } = await import("../src/check.js");
    type Input = Parameters<typeof check>[0];
    const inputFor = (jobs: number) =>
      ({
        version: "0.1.0",
        coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
        diff: { text: movedJobs(jobs) },
        repoRoot: REPO_ROOT,
        threshold: 80,
        repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
        testIntegrityMode: { input: "block" },
      }) as unknown as Input;
    const small = inputFor(SMALL);
    const large = inputFor(LARGE);

    for (const [label, input] of [
      ["5000 jobs", small],
      ["20000 jobs", large],
    ] as const) {
      const report = check(input);
      expectValidReport(report);
      const ti11 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI11");
      expect(ti11, label).toHaveLength(1);
      expect(ti11[0], label).toMatchObject({ severity: "block", path: CI, detail: TEST_STEP });
    }

    const growth = await measureGrowth(
      () => check(small),
      () => check(large),
    );
    expect(growth.ratio, `20000 vs 5000 jobs: ${growth.detail}`).toBeLessThan(8);
  }, 300_000);
});
