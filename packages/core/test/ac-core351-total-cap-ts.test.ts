import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import type { TestSourceDrop, TestSourceObject } from "../src/testSources.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-351 (AC-11), the regression the ticket names: a pull request that modifies enough large TypeScript test files
// pushes one of them past the 16 MiB running total of the sources reader, and removes a test from that one. The read
// plan is computed from object sizes (no 16 MiB input is built or committed): 34 modified test files of 500,000 bytes
// each on the head side, so the 34th in path order (src/t33.test.ts) is dropped as over-total-cap. Its base side is
// read (files of 400,000 bytes), or, in the second test, dropped as over-total-cap too. The texts the plan keeps are
// small stand-ins for the files the sizes describe. planTestSourceReads and check() are loaded inside the test bodies:
// the AC test is written before the build, so nothing the build changes may run while the file loads.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const COUNT = 34;
const PATHS = Array.from({ length: COUNT }, (_, i) => `src/t${String(i).padStart(2, "0")}.test.ts`);
const DROPPED = "src/t33.test.ts";

const LINES = [
  'import { expect, it } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'it("adds the prices", () => {',
  "  expect(total([2, 3])).toBe(5);",
  "});",
  "",
  'it("rejects a negative price", () => {',
  '  expect(() => total([-1])).toThrow("negative price");',
  "});",
];
const BASE = `${LINES.join("\n")}\n`;
/** A kept file's head: one line added after line 5. */
const HEAD_TOUCHED = `${[...LINES.slice(0, 5), "  expect(total([1])).toBe(1);", ...LINES.slice(5)].join("\n")}\n`;
/** The dropped file's head: the second test removed. */
const HEAD_REMOVED = `${LINES.slice(0, 6).join("\n")}\n`;

function diffOf(path: string): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  const body =
    path === DROPPED
      ? ["@@ -7,4 +6,0 @@", "-", `-${LINES[7]}`, `-${LINES[8]}`, `-${LINES[9]}`]
      : ["@@ -5,0 +6 @@", "+  expect(total([1])).toBe(1);"];
  return [...head, ...body].join("\n");
}
const DIFF = `${PATHS.map(diffOf).join("\n")}\n`;

const objects = (size: number) =>
  new Map<string, TestSourceObject | null>(PATHS.map((path) => [path, { type: "blob", size }]));

type Side = { files: { path: string; text: string }[]; dropped: TestSourceDrop[] };

async function side(size: number, text: (path: string) => string): Promise<Side> {
  const { planTestSourceReads } = await import("../src/testSources.js");
  const plan = planTestSourceReads(PATHS, objects(size));
  return { files: plan.read.map((path) => ({ path, text: text(path) })), dropped: plan.dropped };
}

async function run(baseSize: number): Promise<{ report: Report; base: Side; head: Side }> {
  const base = await side(baseSize, () => BASE);
  const head = await side(500_000, (path) => (path === DROPPED ? HEAD_REMOVED : HEAD_TOUCHED));
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: DIFF },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [...PATHS, "src/app.ts", "src/cart.ts"].sort(),
    testIntegrityMode: { input: "block" },
    testSources: { base, head },
  });
  expectValidReport(report);
  return { report, base, head };
}

function expectFailsNaming(report: Report): void {
  const naming = report.messages.filter((m) => m.code === CODE && m.text.includes(`\`${DROPPED}\``));
  expect(naming, `one ${CODE} message names ${DROPPED}`).toHaveLength(1);
  expect(naming[0]?.text, "it names the file with over-total-cap").toContain(`\`${DROPPED}\` (\`over-total-cap\`)`);
  expect(naming[0]?.level, "the message is an error in mode block").toBe("error");
  expect(report.verdict, "the verdict").toBe("fail");
}

describe("CORE-351: a modified TypeScript test file the sources reader dropped past the 16 MiB total fails in mode block", () => {
  it("AC-11: the plan drops src/t33.test.ts as over-total-cap on the head side while its base is read, and the diff removes a test from it: the TEST_INTEGRITY_INDEX_UNAVAILABLE error names it with over-total-cap and the verdict is fail", async () => {
    const { report, base, head } = await run(400_000);
    expect(head.dropped, "the head plan drops only the 34th file, as over-total-cap").toEqual([
      { path: DROPPED, reason: "over-total-cap" },
    ]);
    expect(base.dropped, "the base plan reads every file").toEqual([]);
    expectFailsNaming(report);
  });

  it("AC-11: the plan drops src/t33.test.ts as over-total-cap on both sides: the TEST_INTEGRITY_INDEX_UNAVAILABLE error names it with over-total-cap and the verdict is fail", async () => {
    const { report, base, head } = await run(500_000);
    expect(head.dropped, "the head plan drops only the 34th file, as over-total-cap").toEqual([
      { path: DROPPED, reason: "over-total-cap" },
    ]);
    expect(base.dropped, "the base plan drops the same file, as over-total-cap").toEqual([
      { path: DROPPED, reason: "over-total-cap" },
    ]);
    expectFailsNaming(report);
  });
});
