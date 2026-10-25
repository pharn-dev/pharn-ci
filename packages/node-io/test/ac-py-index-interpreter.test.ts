import { describe, expect, it } from "vitest";

// indexPythonTests and spawnPython are loaded inside each test body: these tests are written before they exist, so
// nothing the build adds may run while the file loads. Fake spawns answer by interpreter name; the last two tests use
// the real spawnPython with an interpreter name that does not exist, and python3.

const SLOW = 60_000;
const REASONS = ["python-not-found", "python-too-old", "python-failed", "timeout", "output-too-large", "bad-output"];

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
type Index = (
  files: { path: string; text: string }[],
  deps: { interpreters?: readonly string[]; spawn?: Spawn },
) => Promise<Run>;

async function load() {
  return (await import("../src/index.js")) as unknown as { indexPythonTests: Index; spawnPython: Spawn };
}

const FILES = [{ path: "tests/test_one.py", text: "def test_one():\n    assert True\n" }];
const MISSING = "pharn-ci-no-such-python-interpreter";
const ENOENT: SpawnResult = { errorCode: "ENOENT", timedOut: false, exitCode: null, stdout: "", stderr: "" };
const OK: SpawnResult = {
  errorCode: null,
  timedOut: false,
  exitCode: 0,
  stdout: JSON.stringify([{ id: 0, parsed: false, reason: "parser-threw" }]),
  stderr: "",
};

/** A fake spawn that answers each interpreter name from `answers` and records the names it was called with. */
function fakeSpawn(answers: Record<string, SpawnResult>) {
  const commands: string[] = [];
  const spawn: Spawn = async (command) => {
    commands.push(command);
    const answer = answers[command];
    if (answer === undefined) throw new Error(`unexpected interpreter ${command}`);
    return answer;
  };
  return { spawn, commands };
}

function expectOneLineDetail(run: Run): void {
  if (run.available) throw new Error("expected an unavailable run");
  expect(typeof run.detail).toBe("string");
  expect(run.detail.length).toBeGreaterThan(0);
  expect(run.detail.length).toBeLessThanOrEqual(300);
  expect(run.detail).not.toMatch(/[\r\n]/);
}

describe("indexPythonTests: finding the interpreter", () => {
  it("AC-14: runs the second interpreter when the first is not found", async () => {
    const { indexPythonTests } = await load();
    const fake = fakeSpawn({ "py-missing": ENOENT, "py-present": OK });

    const run = await indexPythonTests(FILES, { interpreters: ["py-missing", "py-present"], spawn: fake.spawn });

    expect(fake.commands).toEqual(["py-missing", "py-present"]);
    expect(run).toStrictEqual({
      available: true,
      files: [{ path: "tests/test_one.py", result: { parsed: false, reason: "parser-threw" } }],
    });
  });

  it("AC-14: returns python-not-found when no interpreter is found", async () => {
    const { indexPythonTests } = await load();
    const fake = fakeSpawn({ "py-missing": ENOENT, "py-also-missing": ENOENT });

    const run = await indexPythonTests(FILES, { interpreters: ["py-missing", "py-also-missing"], spawn: fake.spawn });

    expect(fake.commands).toEqual(["py-missing", "py-also-missing"]);
    expect(run.available).toBe(false);
    if (run.available) return;
    expect(run.reason).toBe("python-not-found");
    expect("files" in run).toBe(false);
    expectOneLineDetail(run);
  });

  it.each([
    ["it cannot be run (EACCES)", { errorCode: "EACCES", timedOut: false, exitCode: null, stdout: "", stderr: "" }],
    ["it exits non-zero", { errorCode: null, timedOut: false, exitCode: 1, stdout: "", stderr: "Fatal error\n" }],
  ] as [string, SpawnResult][])(
    "AC-14: returns unavailable without trying the second interpreter when the first exists but %s",
    async (_label, failure) => {
      const { indexPythonTests } = await load();
      const fake = fakeSpawn({ "py-broken": failure, "py-present": OK });

      const run = await indexPythonTests(FILES, { interpreters: ["py-broken", "py-present"], spawn: fake.spawn });

      expect(fake.commands).toEqual(["py-broken"]);
      expect(run.available).toBe(false);
      if (run.available) return;
      expect(REASONS).toContain(run.reason);
      expect(run.reason).not.toBe("python-not-found");
      expectOneLineDetail(run);
    },
  );

  it(
    "AC-14: with the real spawn, a missing first interpreter falls through to python3",
    async () => {
      const { indexPythonTests, spawnPython } = await load();
      const commands: string[] = [];
      const spawn: Spawn = (command, args, options, stdin) => {
        commands.push(command);
        return spawnPython(command, args, options, stdin);
      };

      const run = await indexPythonTests(FILES, { interpreters: [MISSING, "python3"], spawn });

      expect(commands).toEqual([MISSING, "python3"]);
      if (!run.available) throw new Error(`the run is unavailable: ${JSON.stringify(run)}`);
      const result = run.files[0]?.result as { parsed: boolean; tests: { name: string }[] };
      expect(result.parsed).toBe(true);
      expect(result.tests.map((b) => b.name)).toEqual(["test_one"]);
    },
    SLOW,
  );

  it(
    "AC-14: with the real spawn, interpreters that do not exist give python-not-found",
    async () => {
      const { indexPythonTests } = await load();

      const run = await indexPythonTests(FILES, { interpreters: [MISSING, `${MISSING}-2`] });

      expect(run.available).toBe(false);
      if (run.available) return;
      expect(run.reason).toBe("python-not-found");
      expectOneLineDetail(run);
    },
    SLOW,
  );
});
