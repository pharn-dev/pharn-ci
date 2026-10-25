import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_TEST_INDEX_DEPTH } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import { indexPythonTests } from "../src/index.js";
import { PYTHON_INDEX_SCRIPT } from "../src/pythonIndexScript.js";

// The Python index enforces its own depth cap after ast.parse, the TS index's MAX_TEST_INDEX_DEPTH, so the answer does
// not depend on how deep the runner's Python lets its parser go (3.12 parses a 100,000-part attribute chain that 3.13
// refuses). The two fixtures differ by one Attribute: depth_at_cap is exactly 1000 nodes deep (the module at 0) and
// depth_over_cap 1001, and every Python from 3.8 parses both. The real interpreter runs; a missing python3 fails.

const FIXTURES = join(import.meta.dirname, "../../../fixtures/py-index");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("indexPythonTests: its own depth cap", () => {
  it("uses core's MAX_TEST_INDEX_DEPTH of 1000 as the script's cap", () => {
    expect(MAX_TEST_INDEX_DEPTH).toBe(1000);
    expect(PYTHON_INDEX_SCRIPT).toContain(`\nMAX_DEPTH = ${MAX_TEST_INDEX_DEPTH}\n`);
  });

  it("parses a tree exactly at the cap and refuses one a level deeper as too-deep, in one run", async () => {
    const run = await indexPythonTests([
      { path: "tests/test_at_cap.py", text: fixture("depth_at_cap.py.txt") },
      { path: "tests/test_over_cap.py", text: fixture("depth_over_cap.py.txt") },
    ]);
    if (!run.available) throw new Error(`the run is unavailable: ${JSON.stringify(run)}`);
    expect(run.files.map((f) => f.path)).toEqual(["tests/test_at_cap.py", "tests/test_over_cap.py"]);

    const atCap = run.files[0]?.result;
    if (atCap === undefined || !atCap.parsed) throw new Error(`the at-cap file was refused: ${JSON.stringify(atCap)}`);
    expect(atCap.tests.map((t) => [t.kind, t.name, t.line])).toEqual([["test", "test_at_cap", 3]]);

    expect(run.files[1]?.result).toStrictEqual({ parsed: false, reason: "too-deep" });
  }, 60_000);
});
