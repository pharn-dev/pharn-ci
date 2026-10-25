import { describe, expect, it } from "vitest";

// indexPythonTests is loaded inside each test body: these tests are written before it exists, so nothing the build
// adds may run while the file loads. A recording fake spawn stands in for the interpreter: it reads the stdin JSON and
// answers each sent file with a parser-threw refusal (PLAN.md's raw output format), so a file refused before the spawn
// (too-large) is told apart from a file that was sent.

const SLOW = 60_000;

type Result = { parsed: false; reason: string } | { parsed: true };
type Run = { available: true; files: { path: string; result: Result }[] } | { available: false; reason: string };
type SpawnResult = {
  errorCode: string | null;
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};
type Spawn = (command: string, args: readonly string[], options: unknown, stdin: string) => Promise<SpawnResult>;
type Index = (files: { path: string; text: string }[], deps: { spawn: Spawn }) => Promise<Run>;

/** A fake spawn that records every stdin it receives and answers each sent entry with a parser-threw refusal. */
function recordingSpawn() {
  const stdins: string[] = [];
  const spawn: Spawn = async (_command, _args, _options, stdin) => {
    stdins.push(stdin);
    const sent = JSON.parse(stdin) as { id: number; text: string }[];
    const stdout = JSON.stringify(sent.map((e) => ({ id: e.id, parsed: false, reason: "parser-threw" })));
    return { errorCode: null, timedOut: false, exitCode: 0, stdout, stderr: "" };
  };
  /** The texts the one recorded spawn was sent, in order. */
  const sentTexts = () => {
    expect(stdins, "the spawn was called once").toHaveLength(1);
    const sent = JSON.parse(stdins[0] as string) as { id: number; text: string }[];
    expect(sent.map((e) => e.id)).toEqual(sent.map((_, i) => i));
    return sent.map((e) => e.text);
  };
  return { spawn, stdins, sentTexts };
}

async function load(): Promise<Index> {
  const io = (await import("../src/index.js")) as unknown as { indexPythonTests: Index };
  return io.indexPythonTests;
}

/** Exactly `bytes` ASCII bytes of Python comments, the first line naming `label`. */
function sized(bytes: number, label: string): string {
  const line = `# ${label} `.padEnd(63, "x").slice(0, 63);
  const lines = Math.floor(bytes / 64);
  const text = `${line}\n`.repeat(lines);
  return text + "#".repeat(bytes - lines * 64);
}

const SENT: Result = { parsed: false, reason: "parser-threw" };
const TOO_LARGE: Result = { parsed: false, reason: "too-large" };
const pad3 = (n: number) => String(n).padStart(3, "0");

describe("indexPythonTests: what is sent, before the spawn", () => {
  it(
    "AC-12: leaves out a .ts file, refuses a .py file of 524,289 bytes as too-large without sending it, and sends one of 524,288",
    async () => {
      const indexPythonTests = await load();
      const fake = recordingSpawn();
      const over = sized(524_289, "over");
      const exact = sized(524_288, "exact");
      expect(Buffer.byteLength(over)).toBe(524_289);
      expect(Buffer.byteLength(exact)).toBe(524_288);

      const run = await indexPythonTests(
        [
          { path: "src/app.test.ts", text: "it('x', () => {});\n" },
          { path: "tests/test_over.py", text: over },
          { path: "tests/test_exact.py", text: exact },
        ],
        { spawn: fake.spawn },
      );

      expect(run).toStrictEqual({
        available: true,
        files: [
          { path: "tests/test_over.py", result: TOO_LARGE },
          { path: "tests/test_exact.py", result: SENT },
        ],
      });
      expect(fake.sentTexts()).toEqual([exact]);
      expect(fake.stdins[0]).not.toContain("# over ");
    },
    SLOW,
  );

  it(
    "AC-12: refuses the 201st .py file as too-large without sending it",
    async () => {
      const indexPythonTests = await load();
      const fake = recordingSpawn();
      const files = Array.from({ length: 201 }, (_, i) => ({
        path: `tests/test_${pad3(i)}.py`,
        text: `# file number ${pad3(i)}\n`,
      }));

      const run = await indexPythonTests(files, { spawn: fake.spawn });

      expect(run).toStrictEqual({
        available: true,
        files: files.map((f, i) => ({ path: f.path, result: i < 200 ? SENT : TOO_LARGE })),
      });
      expect(fake.sentTexts()).toEqual(files.slice(0, 200).map((f) => f.text));
      expect(fake.stdins[0]).not.toContain("# file number 200");
    },
    SLOW,
  );

  it(
    "AC-12: refuses the .py file that would take the total past 16,777,216 bytes as too-large without sending it",
    async () => {
      const indexPythonTests = await load();
      const fake = recordingSpawn();
      // 32 files of 512,000 bytes are 16,384,000; the 33rd would make 16,896,000.
      const files = Array.from({ length: 33 }, (_, i) => ({
        path: `tests/test_big_${pad3(i)}.py`,
        text: sized(512_000, `big ${pad3(i)}`),
      }));

      const run = await indexPythonTests(files, { spawn: fake.spawn });

      if (!run.available) throw new Error(`the run is unavailable: ${JSON.stringify(run)}`);
      expect(run.files.map((f) => f.path)).toEqual(files.map((f) => f.path));
      expect(run.files.slice(0, 32).map((f) => f.result)).toEqual(Array.from({ length: 32 }, () => SENT));
      expect(run.files[32]?.result).toStrictEqual(TOO_LARGE);
      expect(fake.sentTexts()).toEqual(files.slice(0, 32).map((f) => f.text));
      expect(fake.stdins[0]).not.toContain("# big 032 ");
    },
    SLOW,
  );

  it("AC-12: an input with no .py file returns without the spawn being called", async () => {
    const indexPythonTests = await load();
    const fake = recordingSpawn();

    const run = await indexPythonTests(
      [
        { path: "src/app.test.ts", text: "it('x', () => {});\n" },
        { path: "tests/stubs.pyi", text: "def f() -> int: ...\n" },
        { path: "fixtures/test_a.py.txt", text: "def test_a():\n    pass\n" },
      ],
      { spawn: fake.spawn },
    );

    expect(fake.stdins).toHaveLength(0);
    expect(run).toStrictEqual({ available: true, files: [] });
  });
});
