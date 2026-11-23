import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-50 (binary-diff-not-blind). check() and acceptTestIntegrity() are loaded inside the test body: the AC test is
// written before the binary findings exist, so nothing the build changes may run while the file loads. One change holds
// the binary cases of AC-1 (a deleted src/cart.test.ts), AC-5 (a modified test file; its path is moved to
// src/basket.test.ts here, since AC-1 already deletes src/cart.test.ts), AC-9 (package.json, no sources), AC-11 (a
// workflow) and AC-12 (the config in use). The case diffs are read inside the test body.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CONFIG = ".pharn/ci.yml";
const UNAVAILABLE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const ACCEPT = { label: "pharn/accepted", by: "Reviewer-1" };

const caseDiff = (dir: string) => {
  const text = readFileSync(`${FIXTURES}test-integrity/${dir}/change.diff`, "utf8");
  return text.endsWith("\n") ? text : `${text}\n`;
};

/** The workflow path of a case diff: the one `b/.github/workflows/…` path its header names. */
function workflowPath(diff: string): string {
  const paths = diff
    .split("\n")
    .map((l) => /^diff --git a\/\S+ b\/(\.github\/workflows\/\S+)$/.exec(l)?.[1])
    .filter((p): p is string => p !== undefined);
  expect(paths, "one workflow entry").toHaveLength(1);
  return paths[0] as string;
}

describe("CORE-50: the accept label lowers every binary finding", () => {
  it("AC-14: one change with the binary cases of AC-1, AC-5, AC-9, AC-11 and AC-12 fails block; after the accept label every TI01, TI10, TI11 and TI14 is warn, the TEST_INTEGRITY_INDEX_UNAVAILABLE message is warn, and the verdict is not fail", async () => {
    const { check } = await import("./text-coverage.js");
    const { acceptTestIntegrity } = await import("../src/acceptLabel.js");

    const modified = caseDiff("index-unavailable/binary-modified");
    expect(modified).toContain("Binary files a/src/cart.test.ts and b/src/cart.test.ts differ");
    const workflow = caseDiff("TI11/block-binary-workflow-modified");
    const workflowAt = workflowPath(workflow);
    const diff = [
      caseDiff("TI01/block-binary-gitattributes-deleted"),
      modified.split("src/cart.test.ts").join("src/basket.test.ts"),
      caseDiff("TI10/block-binary-no-sources"),
      workflow,
      caseDiff("TI14/block-binary-config-modified"),
    ].join("");

    const report = check({
      version: "0.1.0",
      coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: null,
      repoFiles: [".gitattributes", workflowAt, CONFIG, "package.json", "src/basket.test.ts", "src/cart.ts"],
      testIntegrityMode: { input: "block" },
      configPath: CONFIG,
    });
    expectValidReport(report);

    // Before acceptance: each binary case is there and blocks.
    const blocking = (id: string, path: string) =>
      report.testIntegrity.signals.filter((s) => s.id === id && s.path === path && s.severity === "block");
    expect(blocking("TI01", "src/cart.test.ts"), "the TI01 block of AC-1").toHaveLength(1);
    expect(blocking("TI10", "package.json"), "the TI10 block of AC-9").toHaveLength(1);
    expect(blocking("TI11", workflowAt), "the TI11 block of AC-11").toHaveLength(1);
    expect(blocking("TI14", CONFIG), "the TI14 block of AC-12").toHaveLength(1);
    const before = report.messages.filter((m) => m.code === UNAVAILABLE);
    expect(before, `one ${UNAVAILABLE}`).toHaveLength(1);
    expect(before[0]?.level, "an error before acceptance").toBe("error");
    expect(before[0]?.text, "names the AC-5 file with the reason binary").toContain("`src/basket.test.ts` (`binary`)");
    expect(report.verdict).toBe("fail");

    const accepted = acceptTestIntegrity(structuredClone(report) as never, ACCEPT);
    expectValidReport(accepted);
    const lowered = accepted.testIntegrity.signals.filter((s) => ["TI01", "TI10", "TI11", "TI14"].includes(s.id));
    expect(lowered.length, "the binary signals are kept").toBeGreaterThanOrEqual(4);
    for (const signal of lowered) expect(signal.severity, `${signal.id} ${signal.path}`).toBe("warn");
    const after = accepted.messages.filter((m) => m.code === UNAVAILABLE);
    expect(
      after.map((m) => m.level),
      `${UNAVAILABLE} after acceptance`,
    ).toEqual(["warn"]);
    expect(accepted.verdict).not.toBe("fail");
  });
});
