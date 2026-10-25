import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI11 exists, so nothing the build
// adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CI = ".github/workflows/ci.yml";

function hunk(start: number, removed: string[], added: string[]): string[] {
  const oldPart = removed.length === 0 ? `${start - 1},0` : `${start},${removed.length}`;
  const newPart = added.length === 0 ? `${start - 1},0` : `${start},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

function edit(path: string, hunks: Array<[number, string[], string[]]>): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap(([start, removed, added]) => hunk(start, removed, added))].join("\n")}\n`;
}

async function run(diff: string) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const ti11 = (report: Awaited<ReturnType<typeof run>>) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI11");

describe("TI11: a near-zero timeout, and the edits that fire nothing", () => {
  it("AC-11: timeout-minutes 0 or 1 is a warn finding; 15, an expression, and edits that touch none of the rules are not", async () => {
    for (const minutes of ["0", "1"]) {
      const signals = ti11(await run(edit(CI, [[8, [], [`    timeout-minutes: ${minutes}`]]])));
      expect(signals, minutes).toHaveLength(1);
      expect(signals[0], minutes).toMatchObject({ severity: "warn", path: CI, line: 8 });
    }

    // The same lines in a file that is not a workflow, and in a workflow-looking path outside .github/workflows/.
    const firing = ["    timeout-minutes: 1", "        continue-on-error: true", "  pull_request:"];
    for (const path of [".github/dependabot.yml", "docs/workflows/ci.yml", ".github/workflows/sub/ci.yml.txt"]) {
      expect(ti11(await run(edit(path, [[8, firing.slice(2), firing.slice(0, 2)]]))), path).toEqual([]);
    }

    const quiet: Array<[string, Array<[number, string[], string[]]>]> = [
      ["15 minutes", [[8, [], ["    timeout-minutes: 15"]]]],
      ["an expression", [[8, [], [`    timeout-minutes: \${{ vars.T }}`]]]],
      [
        "an action version bump",
        [[11, ["      - uses: actions/checkout@aaaa # v4"], ["      - uses: actions/checkout@bbbb # v5"]]],
      ],
      ["a new job", [[30, [], ["  lint:", "    runs-on: ubuntu-latest", "    steps:", "      - run: pnpm lint"]]]],
      ["a new step", [[20, [], ["      - run: pnpm build"]]]],
      ["permissions", [[6, [], ["permissions:", "  contents: read"]]]],
      ["a comment", [[2, [], ["# keep the job names, the ruleset lists them"]]]],
    ];
    for (const [label, hunks] of quiet) {
      expect(ti11(await run(edit(CI, hunks))), label).toEqual([]);
    }
  });
});
