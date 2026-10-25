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

/** [path, removed lines, added lines, new-file line of the skip]. */
const CONDITIONAL: Array<[string, string[], string[], number]> = [
  ["e2e/login.spec.ts", [], ['  test.skip(isMobile, "not on mobile")'], 14],
  ["e2e/login.spec.ts", [], ['  test.skip(({ browserName }) => browserName === "firefox", "flaky on firefox")'], 14],
  ["src/user.test.ts", ["it('n', () => {"], ["it.skipIf(process.env.CI)('n', () => {"], 14],
  ["src/user.test.ts", ["it('n', () => {"], ["it.runIf(hasDocker)('n', () => {"], 14],
  ["tests/test_io.py", [], ['@pytest.mark.skipif(sys.platform == "win32", reason="posix only")'], 14],
  ["tests/test_io.py", [], ['@unittest.skipIf(IS_CI, "slow")'], 14],
  ["tests/test_io.py", [], ['@unittest.skipUnless(shutil.which("docker"), "needs docker")'], 14],
  ["tests/test_io.py", [], ['@pytest.mark.xfail(sys.version_info < (3, 11), reason="old python")'], 14],
];

describe("TI03: a conditional skip", () => {
  it("AC-6: each conditional JS/TS skip, skipIf or runIf and Python skipif, skipIf, skipUnless or xfail(cond) is one warn TI03 signal", async () => {
    const details = new Set<string>();
    for (const [path, removed, added, line] of CONDITIONAL) {
      const label = `${path}: ${added[0]}`;
      const signals = ti03(await run(edit(path, [line, line, removed, added])));
      expect(signals, label).toHaveLength(1);
      expect(signals[0], label).toMatchObject({ path, line, severity: "warn" });
      details.add(signals[0]?.detail ?? "");
    }
    // One fixed sentence for the category: the "conditional skip" sentence.
    expect(details.size).toBe(1);
    const [detail] = [...details] as [string];
    expect(detail.length).toBeGreaterThan(0);
    expect(detail.length).toBeLessThanOrEqual(300);
    expect(detail).toMatch(/conditional/i);
    expect(detail).not.toMatch(/unconditional/i);
    for (const text of ["not on mobile", "firefox", "posix only", "needs docker", "old python", "isMobile", "IS_CI"]) {
      expect(detail).not.toContain(text);
    }
  });
});
