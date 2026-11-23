import { describe, expect, it } from "vitest";
import type { TouchedTests } from "../src/signals/testPairs.js";
import type { TestBlock } from "../src/testIndex/types.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-145 part A, AC-6. matchTests, the diff parser and the test index are loaded inside the test body: the AC test is
// written before the moved-test-file matching is folded into matchTests, so nothing the build changes may run while
// this file loads. The inputs are written here.
//
// The diff deletes src/old-checkout.test.ts, whose two tests now sit, with the same names (describe "checkout") and the
// same bodies, in the modified src/checkout.test.ts, where they are new at head. matchTests takes the touched tests and
// the deleted files' indexed tests ({ path, tests, groups } per file, and the paths of a deleted file with a same-stem
// test file added: none here), and its result's movedFiles lists the deleted file as moved and as compared, and pairs
// each of its tests with the new test that holds it. The shapes below are the plan's public shape of matchTests; they
// are written here so this file typechecks before and after the build.

const DELETED = "src/old-checkout.test.ts";
const HOLDER = "src/checkout.test.ts";
const IMPORTS = 'import { describe, expect, it } from "vitest";\nimport { checkout } from "./checkout.js";\n\n';
const CHARGES =
  '  it("charges the card", () => {\n    expect(checkout({ card: "4242", amount: 10 }).charged).toBe(10);\n  });\n';
const REFUSES =
  '  it("refuses an empty cart", () => {\n    expect(() => checkout({ card: "4242", amount: 0 })).toThrow("empty");\n  });\n';
const COUPON =
  '  it("applies a coupon", () => {\n    expect(checkout({ card: "4242", amount: 10, coupon: "HALF" }).charged).toBe(5);\n  });\n';

const DELETED_TEXT = `${IMPORTS}describe("checkout", () => {\n${CHARGES}${REFUSES}});\n`;
const HOLDER_BASE = `// base\n${IMPORTS}describe("checkout", () => {\n${COUPON}});\n`;
const HOLDER_HEAD = `// head\n${IMPORTS}describe("checkout", () => {\n${COUPON}${CHARGES}${REFUSES}});\n`;

interface DeletedTestFile {
  path: string;
  tests: TestBlock[];
  groups: TestBlock[];
}
interface DeletedTestFiles {
  files: readonly DeletedTestFile[];
  stemLinked: ReadonlySet<string>;
}
interface MatchedPair {
  basePath: string;
  base: TestBlock;
  headPath: string;
  head: TestBlock;
}
interface MovedFiles {
  moved: ReadonlySet<string>;
  compared: ReadonlySet<string>;
  pairs: readonly MatchedPair[];
}
type MatchTests = (
  touched: Pick<TouchedTests, "pairs" | "added">,
  deleted?: DeletedTestFiles,
) => { movedFiles?: MovedFiles };

const linesOf = (text: string) => (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
const fullName = (b: TestBlock) => b.path.join(" › ");

function diffText(): string {
  const removed = linesOf(DELETED_TEXT);
  return [
    `diff --git a/${HOLDER} b/${HOLDER}`,
    "index 1111111..2222222 100644",
    `--- a/${HOLDER}`,
    `+++ b/${HOLDER}`,
    "@@ -1 +1 @@",
    "-// base",
    "+// head",
    `diff --git a/${DELETED} b/${DELETED}`,
    "deleted file mode 100644",
    "index 5555555..0000000",
    `--- a/${DELETED}`,
    "+++ /dev/null",
    `@@ -1,${removed.length} +0,0 @@`,
    ...removed.map((line) => `-${line}`),
    "",
  ].join("\n");
}

describe("matchTests: the moved-test-file matching is part of the one pairing module", () => {
  it("AC-6: a deleted test file whose every test is held, by name and body, by a new test of another touched test file is listed as moved and as compared, and each of its tests is paired with the new test that holds it", async () => {
    const core = await import("@pharn-ci/core");
    const { indexTouchedTestFiles } = await import("../src/signals/testPairs.js");
    const { indexTestFile } = await import("../src/testIndex/indexTestFile.js");
    const match = await import("../src/signals/testMatch.js");
    const matchTests = match.matchTests as unknown as MatchTests;

    const indexed = indexTestFile(DELETED, DELETED_TEXT);
    if (!indexed.parsed) throw new Error(`the deleted file does not parse: ${JSON.stringify(indexed)}`);
    const tests = indexed.tests.filter((b) => b.kind === "test").sort((a, b) => a.line - b.line);
    const groups = indexed.tests.filter((b) => b.kind === "describe");
    expect(tests.map(fullName), "the deleted file's tests").toEqual([
      "checkout › charges the card",
      "checkout › refuses an empty cart",
    ]);

    const sources = {
      base: {
        files: [
          { path: HOLDER, text: HOLDER_BASE },
          { path: DELETED, text: DELETED_TEXT },
        ],
        dropped: [],
      },
      head: { files: [{ path: HOLDER, text: HOLDER_HEAD }], dropped: [] },
    };
    const touched = indexTouchedTestFiles(core.parseUnifiedDiff(diffText()), sources, undefined);
    expect(
      touched.pairs.map((p) => p.headPath),
      "the holder is the one compared file",
    ).toEqual([HOLDER]);
    const holderHead = touched.pairs[0]?.head ?? [];
    const holdsCharges = holderHead.find((b) => fullName(b) === "checkout › charges the card");
    const holdsRefuses = holderHead.find((b) => fullName(b) === "checkout › refuses an empty cart");
    if (holdsCharges === undefined || holdsRefuses === undefined) throw new Error("the holder lacks a moved test");
    for (const [was, now] of [
      [tests[0], holdsCharges],
      [tests[1], holdsRefuses],
    ] as const) {
      expect(now.bodyHash, `${fullName(now)} keeps its body`).toBe(was?.bodyHash);
    }
    // The same change through check(): the deleted file's tests are found again, so TI01 is info (the moved-file case).
    const { check } = await import("./text-coverage.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diffText() },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: [HOLDER, "src/checkout.ts"],
      testSources: sources,
      testIntegrityMode: { input: "block" },
    });
    expectValidReport(report);
    expect(
      report.testIntegrity.signals.filter((s) => s.id === "TI01").map((s) => [s.path, s.severity]),
      "check() reads the change as a moved test file",
    ).toEqual([[DELETED, "info"]]);

    const result = matchTests(touched, { files: [{ path: DELETED, tests, groups }], stemLinked: new Set() });
    const moved = result.movedFiles;
    expect(moved, "matchTests returns the moved-file result").toBeDefined();
    if (moved === undefined) return;
    expect([...moved.moved], "the deleted file is moved").toEqual([DELETED]);
    expect([...moved.compared], "the deleted file is compared").toEqual([DELETED]);
    expect(
      moved.pairs.map(
        (p) => `${p.basePath} › ${fullName(p.base)} -> ${p.headPath}:${p.head.line} › ${fullName(p.head)}`,
      ),
      "each test of the deleted file is paired with the new test that holds it",
    ).toEqual([
      `${DELETED} › checkout › charges the card -> ${HOLDER}:${holdsCharges.line} › checkout › charges the card`,
      `${DELETED} › checkout › refuses an empty cart -> ${HOLDER}:${holdsRefuses.line} › checkout › refuses an empty cart`,
    ]);
  });
});
