import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "./schema.js";

// CORE-53 (R2.4), the core side: the raw Python index output may carry the four optional block fields, the line pass
// reads `raise unittest.SkipTest(` and `pytest.importorskip(`, and the TI03 pair pass reports a test that gained a
// switch-off form. The indexes here are written by hand as the index script writes them (no python3 runs), over the
// fixtures under fixtures/test-integrity/python-switch-off/. Modules are loaded inside each test body.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const PY = "tests/test_user.py";
const EXISTING =
  "An unconditional skip was added to a test that the diff shows existed before this change, so that test no longer runs.";
const CONDITIONAL = "A conditional skip was added; the test is skipped only where its condition holds.";
const MODULE =
  "A module-level skip was added (pytest.importorskip, or pytest.skip with allow_module_level=True); every test of the file is skipped wherever it takes effect.";

type Mapped = { available: true; results: unknown[] } | { available: false; reason: string; detail: string };

interface RawBlock {
  kind: string;
  name: string;
  path: string[];
  line: number;
  endLine: number;
  modifiers: string[];
  bodyStart: number;
  bodyEnd: number;
  assertions: unknown[];
  [extra: string]: unknown;
}

/** A raw block as the index script writes it, with an empty body and the extra fields given. */
function raw(name: string, line: number, endLine: number, extra: Record<string, unknown> = {}): RawBlock {
  const { modifiers, ...rest } = extra;
  return {
    kind: name.startsWith("Test") ? "describe" : "test",
    name,
    path: [name],
    line,
    endLine,
    modifiers: (modifiers as string[] | undefined) ?? [],
    bodyStart: 0,
    bodyEnd: 0,
    assertions: [],
    ...rest,
  };
}

async function fromRaw(tests: RawBlock[][]): Promise<Mapped> {
  const { pythonIndexFromRaw } = await import("@pharn-ci/core");
  return pythonIndexFromRaw(
    JSON.stringify(tests.map((list, id) => ({ id, parsed: true, normalized: "", tests: list, mocks: [] }))),
    tests.length,
  ) as Mapped;
}

function sideFiles(dir: string): { path: string; text: string }[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }));
}

/** The fixture's TI03 signals, with the Python index of each side written by hand as `base` and `head`. */
async function ti03Of(name: string, base: RawBlock[], head: RawBlock[]) {
  const root = `${FIXTURES}test-integrity/python-switch-off/${name}/`;
  const mapped = await fromRaw([base, head]);
  if (!mapped.available) throw new Error(mapped.detail);
  const [baseResult, headResult] = mapped.results;
  const testSources = {
    base: { files: sideFiles(`${root}base`), dropped: [] },
    head: { files: sideFiles(`${root}head`), dropped: [] },
  };
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: readFileSync(`${root}change.diff`, "utf8") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: 80,
    repoFiles: [PY, "src/cart.ts"],
    testSources,
    pythonTestIndex: {
      available: true,
      base: [{ path: PY, result: baseResult }],
      head: [{ path: PY, result: headResult }],
    },
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return (
    report as unknown as { testIntegrity: { signals: { id: string; severity: string; line: number }[] } }
  ).testIntegrity.signals
    .filter((s) => s.id === "TI03")
    .map((s) => ({ severity: s.severity, line: s.line, detail: (s as unknown as { detail: string }).detail }));
}

/** The base index of the shared base file: two tests, unskipped. */
const BASE = () => [raw("test_full_name", 6, 7), raw("test_empty_names", 10, 11)];

describe("CORE-53: the raw Python index output may carry the optional switch-off fields", () => {
  it("maps guarded, emptyTable, removedAt and moduleSkip onto the block, and leaves them out when absent", async () => {
    const mapped = await fromRaw([
      [raw("test_a", 1, 2, { guarded: "if", emptyTable: true, removedAt: 7, moduleSkip: 3 }), raw("test_b", 4, 5)],
    ]);
    expect(mapped.available).toBe(true);
    const [result] = (mapped as { results: { tests: Record<string, unknown>[] }[] }).results;
    const [a, b] = result?.tests ?? [];
    expect(a).toMatchObject({ name: "test_a", guarded: "if", emptyTable: true, removedAt: 7, moduleSkip: 3 });
    expect(Object.keys(b ?? {})).not.toContain("guarded");
    expect(Object.keys(b ?? {})).not.toContain("emptyTable");
    expect(Object.keys(b ?? {})).not.toContain("removedAt");
    expect(Object.keys(b ?? {})).not.toContain("moduleSkip");
  });

  it("refuses a wrong value of any of them, and still refuses an unknown key, as bad-output", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ guarded: "while" }, "block guarded is unknown"],
      [{ guarded: true }, "block guarded is not a string"],
      [{ emptyTable: false }, "block emptyTable is not true"],
      [{ removedAt: 0 }, "block removedAt is below 1"],
      [{ moduleSkip: "6" }, "block moduleSkip is not an integer"],
      [{ shadowed: true }, "a block has missing or extra keys"],
    ];
    for (const [extra, detail] of cases) {
      const mapped = await fromRaw([[raw("test_a", 1, 2, extra)]]);
      expect(mapped, JSON.stringify(extra)).toEqual({
        available: false,
        reason: "bad-output",
        detail: `entry 0 test 0: ${detail}`,
      });
    }
  });
});

describe("CORE-53: the TI03 line pass reads `raise unittest.SkipTest(` and `pytest.importorskip(`", () => {
  it("reads them as calls, literally and through the file's aliases; a SkipTest built but not raised is not one", async () => {
    const { parsePythonSkip } = await import("../src/signals/testLines.js");
    expect(parsePythonSkip('    raise unittest.SkipTest("broken")')).toEqual({
      kind: "call",
      token: "unittest.SkipTest",
      name: "broken",
      conditional: false,
    });
    expect(parsePythonSkip('raise SkipTest("x")')).toBeNull();
    expect(parsePythonSkip('raise SkipTest("x")', new Map([["SkipTest", "unittest.SkipTest"]]))).toMatchObject({
      kind: "call",
      token: "unittest.SkipTest",
    });
    expect(parsePythonSkip('unittest.SkipTest("x")')).toBeNull();
    expect(parsePythonSkip('raise pytest.skip("x")')).toBeNull();
    expect(parsePythonSkip("raise unittest.SkipTest")).toBeNull();
    expect(parsePythonSkip('pytest.importorskip("numpy")')).toMatchObject({
      kind: "call",
      token: "pytest.importorskip",
    });
  });
});

describe("CORE-53: the TI03 pair pass reports a test that gained a switch-off form", () => {
  it("a guard the test gained is a warn conditional skip at its def line", async () => {
    const head = [raw("test_full_name", 9, 10, { guarded: "if" }), raw("test_empty_names", 13, 14)];
    expect(await ti03Of("warn-if-guard", BASE(), head)).toEqual([{ severity: "warn", line: 9, detail: CONDITIONAL }]);
  });

  it("a guard the test already had at base gives nothing", async () => {
    const both = () => [raw("test_full_name", 9, 10, { guarded: "if" }), raw("test_empty_names", 13, 14)];
    expect(await ti03Of("pass-if-guard-unchanged", both(), both())).toEqual([]);
  });

  it("a test removed by a later statement is a block at that statement's line when it is added", async () => {
    const head = [raw("test_full_name", 6, 7, { modifiers: ["skip"], removedAt: 14 }), raw("test_empty_names", 10, 11)];
    expect(await ti03Of("block-del-test", BASE(), head)).toEqual([{ severity: "block", line: 14, detail: EXISTING }]);
    const duplicate = [...head, raw("test_full_name", 14, 15)];
    expect(await ti03Of("block-duplicate-def", BASE(), duplicate)).toEqual([
      { severity: "block", line: 14, detail: EXISTING },
    ]);
  });

  it("a removal at a line the diff did not add falls back to the def line", async () => {
    const head = [raw("test_full_name", 6, 7, { modifiers: ["skip"], removedAt: 11 }), raw("test_empty_names", 10, 11)];
    expect(await ti03Of("block-del-test", BASE(), head)).toEqual([{ severity: "block", line: 6, detail: EXISTING }]);
  });

  it("an empty parametrize table the test gained is a block at its def line", async () => {
    const head = [
      raw("test_full_name", 7, 8, { modifiers: ["each"], emptyTable: true }),
      raw("test_empty_names", 11, 12),
    ];
    expect(await ti03Of("block-parametrize-empty", BASE(), head)).toEqual([
      { severity: "block", line: 7, detail: EXISTING },
    ]);
  });

  it("a module skip the tests gained is one warn finding at its line, in mode block", async () => {
    const head = [raw("test_full_name", 8, 9, { moduleSkip: 5 }), raw("test_empty_names", 12, 13, { moduleSkip: 5 })];
    expect(await ti03Of("warn-importorskip", BASE(), head)).toEqual([{ severity: "warn", line: 5, detail: MODULE }]);
  });

  it("a module-level pytest.skip line the line pass also reads gives one warn finding with the module sentence", async () => {
    const head = [raw("test_full_name", 11, 12, { moduleSkip: 8 }), raw("test_empty_names", 15, 16, { moduleSkip: 8 })];
    expect(await ti03Of("warn-skip-module-level", BASE(), head)).toEqual([
      { severity: "warn", line: 8, detail: MODULE },
    ]);
  });

  it("a module skip already at base gives nothing", async () => {
    const both = () => [
      raw("test_full_name", 8, 9, { moduleSkip: 5 }),
      raw("test_empty_names", 12, 13, { moduleSkip: 5 }),
    ];
    expect(await ti03Of("pass-importorskip-at-base", both(), both())).toEqual([]);
  });

  it("a raise of unittest.SkipTest the test gained is a block at the raise line", async () => {
    const head = [raw("test_full_name", 8, 10, { modifiers: ["skip"] }), raw("test_empty_names", 13, 14)];
    expect(await ti03Of("block-raise-skiptest", BASE(), head)).toEqual([
      { severity: "block", line: 9, detail: EXISTING },
    ]);
  });
});
