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

async function run(diff: string, exclude: string[]) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    exclude,
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const ti14 = (report: Awaited<ReturnType<typeof run>>) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI14");

describe("TI14: a coverage exclusion added", () => {
  it("AC-4: a flow list, an exclude key with items, and an appended known pattern are block findings; the controls are not", async () => {
    const flow = ti14(await run(edit(CONFIG, [[4, [], ["  exclude: [dist/**, docs/**]"]]]), []));
    expect(flow).toHaveLength(1);
    expect(flow[0]).toMatchObject({ severity: "block", path: CONFIG, line: 4 });

    const block = ti14(await run(edit(CONFIG, [[4, [], ["  exclude:", '    - "gen/**"', "    - vendor/**"]]]), []));
    expect(block).toHaveLength(1);
    expect(block[0]).toMatchObject({ severity: "block", path: CONFIG });

    const appended = ti14(await run(edit(CONFIG, [[6, [], ["    - src/legacy/**"]]]), ["src/legacy/**"]));
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ severity: "block", path: CONFIG, line: 6 });

    for (const finding of [flow[0], block[0], appended[0]]) {
      const detail = finding?.detail ?? "";
      expect(detail.length).toBeGreaterThan(0);
      expect(detail.length).toBeLessThanOrEqual(300);
      for (const pattern of ["dist", "docs", "gen/", "vendor", "legacy"]) expect(detail).not.toContain(pattern);
    }

    const controls: Array<[string, string, string[]]> = [
      ["an exclusion removed", edit(CONFIG, [[6, ["    - dist/**"], []]]), ["dist/**"]],
      [
        "an exclusion moved",
        edit(CONFIG, [
          [6, ["    - dist/**"], []],
          [8, [], ["    - dist/**"]],
        ]),
        ["dist/**"],
      ],
      ["an item added to coverage.file", edit(CONFIG, [[5, [], ["    - coverage/lcov2.info"]]]), ["dist/**"]],
      ["setup.require changed", edit(CONFIG, [[9, ["  require: false"], ["  require: true"]]]), ["dist/**"]],
      ["an unknown item appended", edit(CONFIG, [[6, [], ["    - src/other/**"]]]), ["src/legacy/**"]],
    ];
    for (const [label, diff, exclude] of controls) {
      expect(ti14(await run(diff, exclude)), label).toEqual([]);
    }
  });
});
