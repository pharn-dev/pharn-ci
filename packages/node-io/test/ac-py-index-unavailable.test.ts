import { describe, expect, it } from "vitest";

// indexPythonTests is loaded inside each test body: these tests are written before it exists, so nothing the build
// adds may run while the file loads. A fake spawn returns each process outcome in turn.

type Run =
  | { available: true; files: { path: string; result: unknown }[] }
  | { available: false; reason: string; detail: string };
type SpawnResult = {
  errorCode: string | null;
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};
type Spawn = (command: string, args: readonly string[], options: unknown, stdin: string) => Promise<SpawnResult>;
type Index = (files: { path: string; text: string }[], deps: { spawn: Spawn }) => Promise<Run>;

const FILES = [{ path: "tests/test_one.py", text: "def test_one():\n    assert True\n" }];
const MIB = 1024 * 1024;

const outcome = (fields: Partial<SpawnResult>): SpawnResult => ({
  errorCode: null,
  timedOut: false,
  exitCode: 0,
  stdout: "",
  stderr: "",
  ...fields,
});

const OUTCOMES: [label: string, result: () => SpawnResult, reason: string][] = [
  [
    "the bootstrap's too-old report (Python 3.7)",
    () => outcome({ exitCode: 3, stderr: "pharn-ci-python-too-old 3.7.17\n" }),
    "python-too-old",
  ],
  [
    'an interpreter\'s "Unknown option: -I" rejection',
    () =>
      outcome({
        exitCode: 2,
        stderr:
          "Unknown option: -I\nusage: python [option] ... [-c cmd | -m mod | file | -] [arg] ...\nTry `python -h' for more information.\n",
      }),
    "python-too-old",
  ],
  [
    "a non-zero exit with stderr",
    () =>
      outcome({
        exitCode: 1,
        stderr: `Traceback (most recent call last):\n  File "<x>", line 1\n${"E".repeat(1000)}\u0007\r\nSystemError: boom\n`,
      }),
    "python-failed",
  ],
  ["a timeout kill", () => outcome({ timedOut: true, exitCode: null }), "timeout"],
  ["more than 64 MiB of stdout", () => outcome({ stdout: "x".repeat(64 * MIB + 1) }), "output-too-large"],
  [
    "the max-buffer error",
    () => outcome({ errorCode: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", exitCode: null, stdout: "[" }),
    "output-too-large",
  ],
  ["stdout that is not index JSON", () => outcome({ stdout: '{"hello": "world"}' }), "bad-output"],
  ["stdout that is not JSON at all", () => outcome({ stdout: "Traceback?\n" }), "bad-output"],
  ["an index of the wrong length", () => outcome({ stdout: "[]" }), "bad-output"],
];

describe("indexPythonTests: a run that cannot give an index", () => {
  it.each(OUTCOMES)("AC-15: %s gives an unavailable run with a one-line detail", async (_label, result, reason) => {
    const io = (await import("../src/index.js")) as unknown as { indexPythonTests: Index };
    const spawn: Spawn = async () => result();

    let run: Run;
    try {
      run = await io.indexPythonTests(FILES, { spawn });
    } catch (error) {
      throw new Error(`indexPythonTests threw ${String(error)}`);
    }

    expect(run.available).toBe(false);
    if (run.available) return;
    expect(run.reason).toBe(reason);
    expect(Object.keys(run).sort()).toEqual(["available", "detail", "reason"]);
    expect(typeof run.detail).toBe("string");
    expect(run.detail.length).toBeGreaterThan(0);
    expect(run.detail.length).toBeLessThanOrEqual(300);
    expect(run.detail).not.toMatch(/[\r\n]/);
  });
});
