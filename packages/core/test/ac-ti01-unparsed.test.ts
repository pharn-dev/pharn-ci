import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { indexTestFile } from "../src/testIndex/indexTestFile.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { withoutFix } from "./v090-codes.js";

// fix/unparsed-added-test-file, part 2: a deleted test file with a same-stem test file added keeps TI01 at the mode's
// level when its tests cannot be compared by body. When the base text was read but the test index refused it, the
// detail says it could not be parsed; when there was no text (dropped, no sources), it still says the text was not
// available.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TI01 = `${FIXTURES}test-integrity/TI01`;
const UNPARSED =
  "Test file deleted; a test file of the same name was added, but its text at the merge base could not be parsed to compare their tests.";
const NOT_AVAILABLE =
  "Test file deleted; a test file of the same name was added, but the text to compare their tests was not available.";

interface SourceFile {
  path: string;
  text: string;
}
interface Side {
  files: SourceFile[];
  dropped: { path: string; reason: string }[];
}

/** The `<logical path>.txt` files under one side of a fixture case. */
function sideFiles(dir: string): SourceFile[] {
  try {
    statSync(dir);
  } catch {
    return [];
  }
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt"))
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function run(name: string, sides: { base: Side; head: Side } | undefined, mode: "block" | "warn") {
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: readFileSync(join(TI01, name, "change.diff"), "utf8") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.spec.ts", "src/cart.ts"],
    testIntegrityMode: { input: mode },
    ...(sides === undefined ? {} : { testSources: sides }),
  });
  expectValidReport(report);
  return {
    report,
    // fix-hints (H6): every message and finding now carries a `fix`; the pinned literals are unchanged, so these read without it.
    ti01: withoutFix(report.testIntegrity.signals.filter((signal) => signal.id === "TI01")),
    unavailable: withoutFix(report.messages.filter((message) => message.code === "TEST_INTEGRITY_INDEX_UNAVAILABLE")),
  };
}

describe("TI01: a deleted test file whose base text was read but not parsed", () => {
  it.each(["block", "warn"] as const)(
    "block-same-stem-unparsed in mode %s: one TI01 at the mode's level whose detail says the base text could not be parsed",
    (mode) => {
      const dir = join(TI01, "block-same-stem-unparsed");
      const base = sideFiles(join(dir, "base"));
      expect(
        base.map((file) => file.path),
        "the base text of the deleted file is in the sources",
      ).toEqual(["src/cart.test.ts"]);
      expect(indexTestFile("src/cart.test.ts", base[0]?.text ?? ""), "the test index refuses it").toEqual({
        parsed: false,
        reason: "syntax-error-heavy",
      });
      const { ti01, unavailable } = run(
        "block-same-stem-unparsed",
        { base: { files: base, dropped: [] }, head: { files: sideFiles(join(dir, "head")), dropped: [] } },
        mode,
      );
      expect(ti01).toEqual([{ id: "TI01", severity: mode, path: "src/cart.test.ts", line: null, detail: UNPARSED }]);
      expect(UNPARSED.length).toBeLessThanOrEqual(300);
      // The added same-stem file was read, so nothing is named as unread.
      expect(unavailable, "no index-unavailable message").toEqual([]);
    },
  );

  it("block-same-stem-dropped: a base text dropped as too-large keeps the not-available detail", () => {
    const dir = join(TI01, "block-same-stem-dropped");
    const { ti01, unavailable } = run(
      "block-same-stem-dropped",
      {
        base: { files: [], dropped: [{ path: "src/cart.test.ts", reason: "too-large" }] },
        head: { files: sideFiles(join(dir, "head")), dropped: [] },
      },
      "block",
    );
    expect(ti01).toEqual([
      { id: "TI01", severity: "block", path: "src/cart.test.ts", line: null, detail: NOT_AVAILABLE },
    ]);
    expect(unavailable).toEqual([]);
  });

  it("block-same-stem-unparsed with no test sources keeps the not-available detail", () => {
    const { ti01 } = run("block-same-stem-unparsed", undefined, "block");
    expect(ti01.map((signal) => [signal.severity, signal.detail])).toEqual([["block", NOT_AVAILABLE]]);
  });
});
