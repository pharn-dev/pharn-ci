import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI11 exists, so nothing the build
// adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CI = ".github/workflows/ci.yml";

function addLine(path: string, line: string): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, "@@ -19,0 +20 @@", `+${line}`].join("\n")}\n`;
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

describe("TI11: a step or job disabled by a condition", () => {
  it("AC-10: a literal false or an event-name test that leaves pull requests out is a warn finding; other conditions are not", async () => {
    const disabling = [
      "        if: false",
      `        if: \${{ false }}`,
      "        if: 'false'",
      "        if: github.event_name == 'push'",
      "        if: github.event_name != 'pull_request'",
    ];
    for (const line of disabling) {
      const signals = ti11(await run(addLine(CI, line)));
      expect(signals, line).toHaveLength(1);
      expect(signals[0], line).toMatchObject({ severity: "warn", path: CI, line: 20 });
    }

    const harmless = [
      "        if: always()",
      "        if: success()",
      `        if: \${{ !cancelled() }}`,
      "        if: github.ref == 'refs/heads/main'",
      "        if: contains(github.event.head_commit.message, 'x')",
    ];
    for (const line of harmless) {
      expect(ti11(await run(addLine(CI, line))), line).toEqual([]);
    }
  });
});
