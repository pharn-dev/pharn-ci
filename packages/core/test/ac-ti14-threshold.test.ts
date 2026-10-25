import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI14 exists, so nothing the build
// adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CONFIG = ".pharn/ci.yml";

function hunk(start: number, removed: string[], added: string[]): string[] {
  const oldPart = removed.length === 0 ? `${start - 1},0` : `${start},${removed.length}`;
  const newPart = added.length === 0 ? `${start - 1},0` : `${start},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

function edit(path: string, hunks: Array<[number, string[], string[]]>): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap(([start, removed, added]) => hunk(start, removed, added))].join("\n")}\n`;
}

function removeFile(path: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "deleted file mode 100644", "index 1111111..0000000 100644"];
  const body = [`--- a/${path}`, "+++ /dev/null", `@@ -1,${lines.length} +0,0 @@`, ...lines.map((l) => `-${l}`)];
  return `${[...head, ...body].join("\n")}\n`;
}

async function run(diff: string, mode: "block" | "warn" | "off" = "block") {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: mode },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const ti14 = (report: Awaited<ReturnType<typeof run>>) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI14");

describe("TI14: the coverage threshold lowered", () => {
  it("AC-3: a lowered, removed or deleted threshold is a block finding, quoted or not; raised, moved, added and requoted values are not", async () => {
    const lowered = ti14(await run(edit(CONFIG, [[3, ["  threshold: 80"], ["  threshold: 70"]]])));
    expect(lowered).toHaveLength(1);
    expect(lowered[0]).toMatchObject({ severity: "block", path: CONFIG, line: 3 });
    expect(lowered[0]?.detail).toContain("80");
    expect(lowered[0]?.detail).toContain("70");
    expect(lowered[0]?.detail.length).toBeLessThanOrEqual(300);

    const removed = ti14(await run(edit(CONFIG, [[3, ["  threshold: 80"], []]])));
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ severity: "block", path: CONFIG, line: 3 });
    expect(removed[0]?.detail.toLowerCase()).toContain("removed");

    const deleted = ti14(await run(removeFile(CONFIG, ["coverage:", "  threshold: 80"])));
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ severity: "block", path: CONFIG, line: 2 });

    // The config reads `threshold: "70"` as 70, so a quoted lower value is a lowered threshold like a bare one.
    const quoted = ti14(await run(edit(CONFIG, [[3, ["  threshold: 80"], ['  threshold: "70"']]])));
    expect(quoted).toHaveLength(1);
    expect(quoted[0]).toMatchObject({ severity: "block", path: CONFIG, line: 3 });
    expect(quoted[0]?.detail).toBe("Coverage threshold lowered from 80 to 70.");

    const controls: Array<[string, string]> = [
      ["raised", edit(CONFIG, [[3, ["  threshold: 80"], ["  threshold: 90"]]])],
      ["equal", edit(CONFIG, [[3, ["  threshold: 80"], ["  threshold: 80"]]])],
      [
        "moved",
        edit(CONFIG, [
          [3, ["  threshold: 80"], []],
          [5, [], ["  threshold: 80"]],
        ]),
      ],
      ["added where there was none", edit(CONFIG, [[2, [], ["  threshold: 70"]]])],
      ["requoted, same value", edit(CONFIG, [[3, ["  threshold: 80"], ['  threshold: "80"']]])],
    ];
    for (const [label, diff] of controls) {
      expect(ti14(await run(diff)), label).toEqual([]);
    }
  });
});
