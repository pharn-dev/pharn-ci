import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI03 and TI04 exist, so nothing the
// build adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

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

/** [path, added lines starting at new line 30, new-file lines of the skips among them]. */
const IN_BODY: Array<[string, string[], number[]]> = [
  ["tests/test_io.py", ['    if not shutil.which("docker"):', '        pytest.skip("no docker")'], [31]],
  ["pkg/net_test.go", ["\tif testing.Short() {", '\t\tt.Skip("needs network")', "\t}"], [31]],
  ["pkg/net_test.go", ['\tt.Skipf("no %s", name)'], [30]],
  ["pkg/net_test.go", ["\tt.SkipNow()"], [30]],
  ["src/user.test.ts", ["  test.skip()"], [30]],
  ["src/user.test.ts", ["  test.skip(true)"], [30]],
  ["src/user.test.ts", ["  this.skip()"], [30]],
];

describe("TI03: a skip inside a test body", () => {
  it("AC-7: pytest.skip, t.Skip, t.Skipf, t.SkipNow, test.skip(), test.skip(true) and this.skip() are warn; the if lines give nothing", async () => {
    const details = new Set<string>();
    for (const [path, added, lines] of IN_BODY) {
      const label = `${path}: ${added.join(" / ")}`;
      const signals = ti03(await run(edit(path, [30, 30, [], added])));
      expect(
        signals.map((s) => ({ path: s.path, line: s.line, severity: s.severity })),
        label,
      ).toEqual(lines.map((line) => ({ path, line, severity: "warn" })));
      for (const signal of signals) details.add(signal.detail);
    }

    // The three Go forms together in one file: one signal per skip line, none for the `if` and the brace.
    const go = ti03(
      await run(
        edit("pkg/net_test.go", [
          30,
          30,
          [],
          ["\tif testing.Short() {", '\t\tt.Skip("needs network")', "\t}", '\tt.Skipf("no %s", name)', "\tt.SkipNow()"],
        ]),
      ),
    );
    expect(go.map((s) => s.line)).toEqual([31, 33, 34]);

    // One fixed sentence for the category: the "skip the diff cannot place" sentence.
    expect(details.size).toBe(1);
    const [detail] = [...details] as [string];
    expect(detail.length).toBeGreaterThan(0);
    expect(detail.length).toBeLessThanOrEqual(300);
    expect(detail).toMatch(/cannot|can't|can not|unable/i);
    for (const text of ["no docker", "needs network", "no %s"]) expect(detail).not.toContain(text);
  });
});
