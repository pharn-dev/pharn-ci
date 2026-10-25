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

describe("TI11: the pull request trigger removed", () => {
  it("AC-7: a removed pull_request trigger is a block finding; a kept one is not", async () => {
    const removals: Array<[string, Array<[number, string[], string[]]>]> = [
      ["the pull_request key", [[4, ["  pull_request:"], []]]],
      ["the pull_request_target key", [[4, ["  pull_request_target:"], []]]],
      ["pull_request dropped from a flow list", [[3, ["on: [push, pull_request]"], ["on: [push]"]]]],
      ["on: pull_request replaced by on: push", [[3, ["on: pull_request"], ["on: push"]]]],
    ];
    for (const [label, hunks] of removals) {
      const signals = ti11(await run(edit(CI, hunks)));
      expect(signals, label).toHaveLength(1);
      expect(signals[0], label).toMatchObject({ severity: "block", path: CI });
    }

    const controls: Array<[string, Array<[number, string[], string[]]>]> = [
      ["a push trigger added beside a kept pull_request", [[4, [], ["  push:"]]]],
      ["pull_request replaced by pull_request_target", [[4, ["  pull_request:"], ["  pull_request_target:"]]]],
    ];
    for (const [label, hunks] of controls) {
      expect(ti11(await run(edit(CI, hunks))), label).toEqual([]);
    }
  });
});
