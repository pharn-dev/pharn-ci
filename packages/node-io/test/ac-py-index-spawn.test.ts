import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

// indexPythonTests and the script constants are loaded inside the test body: this test is written before they exist,
// so nothing the build adds may run while the file loads. A recording fake spawn stands in for the interpreter and
// answers with PLAN.md's raw output format.

type Run = { available: true; files: { path: string; result: unknown }[] } | { available: false; reason: string };
type SpawnResult = {
  errorCode: string | null;
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};
type Spawn = (command: string, args: readonly string[], options: unknown, stdin: string) => Promise<SpawnResult>;
type Recorded = { command: string; args: readonly string[]; options: unknown; stdin: string };

const PLANTED_ENV: Record<string, string> = {
  PYTHONPATH: "/tmp/pharn-ci-planted",
  PYTHONSTARTUP: "/tmp/pharn-ci-planted/startup.py",
  HOME: "/tmp/pharn-ci-home",
  PHARN_CI_UNRELATED_VARIABLE: "unrelated",
};

const saved = new Map<string, string | undefined>();
function setEnv(name: string, value: string | undefined): void {
  if (!saved.has(name)) saved.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

const PATH_MARKER = "secret_path_marker";
const TEXT = "def test_spawned():\n    assert True\n";

describe("indexPythonTests: how the interpreter is spawned", () => {
  it.each([
    ["without SYSTEMROOT", undefined],
    ["with SYSTEMROOT", "C:\\Windows"],
  ] as [string, string | undefined][])(
    "AC-13: spawns python3 once with -I -S -B -c, the bootstrap and the main script, no shell, the tmpdir cwd, a minimal env (%s), the timeout and output cap, and a stdin of ids and texts only",
    async (_label, systemRoot) => {
      const io = (await import("../src/index.js")) as unknown as {
        indexPythonTests: (files: { path: string; text: string }[], deps: { spawn: Spawn }) => Promise<Run>;
        PYTHON_BOOTSTRAP: string;
        PYTHON_INDEX_SCRIPT: string;
      };
      expect(typeof io.PYTHON_BOOTSTRAP).toBe("string");
      expect(typeof io.PYTHON_INDEX_SCRIPT).toBe("string");
      expect(io.PYTHON_BOOTSTRAP.length).toBeGreaterThan(0);
      expect(io.PYTHON_INDEX_SCRIPT.length).toBeGreaterThan(0);

      for (const [name, value] of Object.entries(PLANTED_ENV)) setEnv(name, value);
      setEnv("SYSTEMROOT", systemRoot);
      const path = process.env.PATH;
      expect(path, "the parent has a PATH").toBeDefined();

      const calls: Recorded[] = [];
      const spawn: Spawn = async (command, args, options, stdin) => {
        calls.push({ command, args: [...args], options, stdin });
        return {
          errorCode: null,
          timedOut: false,
          exitCode: 0,
          stdout: JSON.stringify([{ id: 0, parsed: false, reason: "parser-threw" }]),
          stderr: "",
        };
      };

      const run = await io.indexPythonTests([{ path: `tests/${PATH_MARKER}/test_spawned.py`, text: TEXT }], { spawn });

      expect(run.available).toBe(true);
      expect(calls).toHaveLength(1);
      const call = calls[0] as Recorded;
      expect(call.command).toBe("python3");
      expect(call.args).toStrictEqual(["-I", "-S", "-B", "-c", io.PYTHON_BOOTSTRAP, io.PYTHON_INDEX_SCRIPT]);
      expect(call.options).toStrictEqual({
        cwd: tmpdir(),
        env: systemRoot === undefined ? { PATH: path } : { PATH: path, SYSTEMROOT: systemRoot },
        shell: false,
        timeout: 30_000,
        killSignal: "SIGKILL",
        maxBuffer: 67_108_864,
      });
      expect(JSON.parse(call.stdin)).toStrictEqual([{ id: 0, text: TEXT }]);
      expect(call.stdin).not.toContain(PATH_MARKER);
      expect(call.stdin).not.toContain("tests/");
    },
  );
});
