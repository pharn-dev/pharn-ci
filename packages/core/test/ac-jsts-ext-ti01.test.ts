import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded from the package inside each test body: the AC test is written before `.test.mts` and
// `.spec.cts` are test files by name, so nothing the build changes may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
/** The source files stay in the tree: the change deletes only the test file. */
const REPO_FILES = ["package.json", "src/cart.ts", "src/cart.mts", "src/cart.cts"];
/** The text of the deleted test file: it holds `it(` tests. */
const TEST_LINES = [
  'import { describe, expect, it } from "vitest";',
  'import { addItem } from "./cart";',
  'describe("cart", () => {',
  '  it("adds an item", () => {',
  "    expect(addItem([], 1)).toEqual([1]);",
  "  });",
  '  it("keeps the order", () => {',
  "    expect(addItem([1], 2)).toEqual([1, 2]);",
  "  });",
  "});",
];

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}

/** A file the diff deletes (status deleted), with every line of its base text removed. */
function deleteFile(path: string, lines: string[]): string {
  const head = [
    `diff --git a/${path} b/${path}`,
    "deleted file mode 100644",
    "index 5555555..0000000",
    `--- a/${path}`,
    "+++ /dev/null",
  ];
  return `${[...head, `@@ -1,${lines.length} +0,0 @@`, ...lines.map((l) => `-${l}`)].join("\n")}\n`;
}

async function ti01(path: string): Promise<Signal[]> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: deleteFile(path, TEST_LINES) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: REPO_FILES,
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return (report.testIntegrity.signals as unknown as Signal[]).filter((s) => String(s.id) === "TI01");
}

/** The signal with its path folded to a placeholder, so two deletions can be compared field by field. */
const folded = (signal: Signal, path: string) => ({
  id: signal.id,
  severity: signal.severity,
  line: signal.line,
  detail: signal.detail.split(path).join("<path>"),
});

describe("check(): TI01 for a deleted .test.mts or .spec.cts test file", () => {
  it("AC-1: deleting src/cart.test.mts, and separately src/cart.spec.cts, holding tests gives the TI01 block signal a src/cart.test.ts deletion gives", async () => {
    const baseline = await ti01("src/cart.test.ts");
    expect(baseline, "the src/cart.test.ts deletion gives one TI01").toHaveLength(1);
    const reference = baseline[0] as Signal;
    expect(reference.severity).toBe("block");
    expect(reference.path).toBe("src/cart.test.ts");

    for (const path of ["src/cart.test.mts", "src/cart.spec.cts"]) {
      const signals = await ti01(path);
      expect(signals, `${path}: one TI01 signal`).toHaveLength(1);
      const signal = signals[0] as Signal;
      expect(signal.severity, `${path}: at block`).toBe("block");
      expect(signal.path, `${path}: names the deleted path`).toBe(path);
      expect(folded(signal, path), `${path}: the same signal as the .test.ts deletion`).toEqual(
        folded(reference, "src/cart.test.ts"),
      );
    }
  });
});
