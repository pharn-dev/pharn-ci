import { describe, expect, it } from "vitest";

// indexPythonTests and spawnPython are loaded inside the test body: this test is written before they exist, so
// nothing the build adds may run while the file loads. The real interpreter runs through the exported spawnPython,
// wrapped to count the spawns; a missing python3 fails the test.

const SLOW = 60_000;

type Result =
  | { parsed: true; syntaxErrors: number; tests: { kind: string; name: string }[] }
  | { parsed: false; reason: string };
type Run = { available: true; files: { path: string; result: Result }[] } | { available: false; reason: string };
type Spawn = (command: string, args: readonly string[], options: unknown, stdin: string) => Promise<unknown>;

const FILES = [
  { path: "tests/test_first.py", text: "def test_first():\n    assert 1 == 1\n" },
  { path: "tests/test_broken.py", text: "def test_broken(:\n    pass\n" },
  { path: "tests/test_nul.py", text: "def test_nul():\n    x = 1\u0000\n    assert x\n" },
  { path: "tests/test_last.py", text: "def test_last():\n    assert 2 == 2\n" },
];

describe("indexPythonTests: per-file refusals", () => {
  it(
    "AC-9: refuses the syntax-error and NUL-byte files as syntax-error, parses both valid files, keeps input order, and spawns once",
    async () => {
      const io = (await import("../src/index.js")) as unknown as {
        indexPythonTests: (files: { path: string; text: string }[], deps: { spawn: Spawn }) => Promise<Run>;
        spawnPython: Spawn;
      };
      expect(typeof io.spawnPython).toBe("function");
      let spawns = 0;
      const spawn: Spawn = (command, args, options, stdin) => {
        spawns++;
        return io.spawnPython(command, args, options, stdin);
      };

      const run = await io.indexPythonTests(FILES, { spawn });

      if (!run.available) throw new Error(`the run is unavailable: ${JSON.stringify(run)}`);
      expect(spawns, "the interpreter is spawned exactly once").toBe(1);
      expect(run.files.map((f) => f.path)).toEqual(FILES.map((f) => f.path));
      const [first, broken, nul, last] = run.files.map((f) => f.result);
      expect(broken).toStrictEqual({ parsed: false, reason: "syntax-error" });
      expect(nul).toStrictEqual({ parsed: false, reason: "syntax-error" });
      for (const [result, name] of [
        [first, "test_first"],
        [last, "test_last"],
      ] as [Result, string][]) {
        if (!result.parsed) throw new Error(`${name} was refused: ${JSON.stringify(result)}`);
        expect(result.syntaxErrors).toBe(0);
        expect(result.tests.map((b) => [b.kind, b.name])).toEqual([["test", name]]);
      }
    },
    SLOW,
  );
});
