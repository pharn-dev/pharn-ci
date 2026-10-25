import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI11 exists, so nothing the build
// adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CI = ".github/workflows/ci.yml";

function edit(path: string, removed: string, added: string): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, "@@ -12 +12 @@", `-${removed}`, `+${added}`].join("\n")}\n`;
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

describe("TI11: the matrix reduced", () => {
  it("AC-8: a reduced flow-list matrix is a warn finding in mode block; a grown one is not", async () => {
    for (const [label, added] of [
      ["to two versions", "        node-version: [20, 22]"],
      ["to one version", "        node-version: [22]"],
    ] as const) {
      const report = await run(edit(CI, "        node-version: [18, 20, 22]", added));
      const signals = ti11(report);
      expect(signals, label).toHaveLength(1);
      expect(signals[0], label).toMatchObject({ severity: "warn", path: CI, line: 12 });
      expect(report.testIntegrity.verdict, label).toBe("warn");
    }

    expect(
      ti11(await run(edit(CI, "        node-version: [18, 20, 22]", "        node-version: [18, 20, 22, 24]"))),
    ).toEqual([]);
    expect(
      ti11(await run(edit(CI, "        os: [ubuntu-latest]", "        os: [ubuntu-latest, macos-latest]"))),
    ).toEqual([]);
  });
});
