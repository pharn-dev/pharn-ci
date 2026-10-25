import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI03 and TI04 exist, so nothing the
// build adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "tests/test_user.py";

/** One hunk of a `--unified=0` diff: the first old and new line of the change, the removed and the added lines. */
type Hunk = [oldStart: number, newStart: number, removed: string[], added: string[]];

function hunk([oldStart, newStart, removed, added]: Hunk): string[] {
  const oldPart = removed.length === 0 ? `${oldStart - 1},0` : `${oldStart},${removed.length}`;
  const newPart = added.length === 0 ? `${newStart - 1},0` : `${newStart},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

function edit(path: string, ...hunks: Hunk[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap((h) => hunk(h))].join("\n")}\n`;
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

const ti03 = (report: Awaited<ReturnType<typeof run>>) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI03");

/** Unconditional skip and xfail decorators: no arguments, a string first argument, or a keyword argument. */
const DECORATORS = [
  '@pytest.mark.skip(reason="flaky")',
  "@pytest.mark.skip",
  '@unittest.skip("broken")',
  "@pytest.mark.xfail",
  '@pytest.mark.xfail(reason="known bug")',
];

describe("TI03: an unconditional Python skip decorator above an unchanged test", () => {
  it("AC-5: each decorator added alone above an unchanged def test_x or class TestUser is one block TI03 signal", async () => {
    const details = new Set<string>();

    // Above an unchanged `def test_x():` at new line 9: the hunk adds only the decorator, at new line 8.
    for (const decorator of DECORATORS) {
      const signals = ti03(await run(edit(PATH, [8, 8, [], [decorator]])));
      expect(signals, decorator).toHaveLength(1);
      expect(signals[0], decorator).toMatchObject({ path: PATH, line: 8, severity: "block" });
      details.add(signals[0]?.detail ?? "");
    }

    // The same diff above an unchanged `class TestUser:` at new line 21.
    const classSignals = ti03(await run(edit(PATH, [20, 20, [], ['@pytest.mark.skip(reason="flaky")']])));
    expect(classSignals).toHaveLength(1);
    expect(classSignals[0]).toMatchObject({ path: PATH, line: 20, severity: "block" });
    details.add(classSignals[0]?.detail ?? "");

    // One fixed sentence: the "unconditional skip on an existing test" sentence, with no reason text.
    expect(details.size).toBe(1);
    const [detail] = [...details] as [string];
    expect(detail.length).toBeGreaterThan(0);
    expect(detail.length).toBeLessThanOrEqual(300);
    expect(detail).toMatch(/unconditional/i);
    for (const reason of ["flaky", "broken", "known bug"]) expect(detail).not.toContain(reason);
  });
});
