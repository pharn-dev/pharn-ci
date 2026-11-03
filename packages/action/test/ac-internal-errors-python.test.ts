import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { harness, PR_CONTEXT } from "./harness.js";

// run(), main(), createNodeIo(), nodeDeps() and indexPythonTests() are loaded inside the test body: the AC test is
// written before the build stops turning a throw of our own Python output mapping into an unavailable index, so
// nothing the build changes may run while the file loads. Git is real (one temporary repository). The Python index is
// node-io's real indexPythonTests with an injected fake spawn that answers a VALID raw output, so no python3 is needed
// and the fault sits below pythonIndexFromRaw's own catch: a mapping helper the raw-output mapping calls
// (testIndex/text.ts trimBodySpaces) throws one TypeError while armed. With the fault not armed, the fake spawn's
// genuine failures must still give an unavailable index, exactly as today.

const fault = vi.hoisted(() => ({
  armed: false,
  calls: 0,
  error: new TypeError("AC-7 injected fault in the Python output mapping"),
}));

vi.mock("../../core/src/testIndex/text.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../core/src/testIndex/text.ts")>();
  return {
    ...real,
    trimBodySpaces: (...args: Parameters<typeof real.trimBodySpaces>) => {
      if (fault.armed) {
        fault.calls++;
        throw fault.error;
      }
      return real.trimBodySpaces(...args);
    },
  };
});

const PY_PATH = "tests/test_x.py";
const PY_BASE = "def test_adds():\n    assert 1 + 1 == 2\n\n\ndef test_subtracts():\n    assert 2 - 1 == 1\n";
const PY_HEAD = "def test_adds():\n    assert 1 + 1 == 2\n";
const UNAVAILABLE = /Python test index is unavailable/;

type SpawnResult = {
  errorCode: string | null;
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};
type Spawn = (command: string, args: readonly string[], options: unknown, stdin: string) => Promise<SpawnResult>;
type PyFile = { path: string; text: string };
type IndexPythonTests = (files: readonly PyFile[], deps: { spawn: Spawn }) => Promise<unknown>;

const outcome = (fields: Partial<SpawnResult>): SpawnResult => ({
  errorCode: null,
  timedOut: false,
  exitCode: 0,
  stdout: "",
  stderr: "",
  ...fields,
});

/** A valid raw output (one parsed entry per stdin entry, each with one test and one assertion). */
const validRun: Spawn = async (_command, _args, _options, stdin) => {
  const entries = JSON.parse(stdin) as { id: number; text: string }[];
  const normalized = "def test_adds(): assert 1 + 1 == 2";
  const bodyStart = normalized.indexOf(":") + 1;
  return outcome({
    stdout: JSON.stringify(
      entries.map(({ id }) => ({
        id,
        parsed: true,
        normalized,
        tests: [
          {
            kind: "test",
            name: "test_adds",
            path: ["test_adds"],
            line: 1,
            endLine: 2,
            modifiers: [],
            bodyStart,
            bodyEnd: normalized.length,
            assertions: [{ chain: "assert ==", line: 2, awaited: false, inTryCatch: false, afterEarlyReturn: false }],
          },
        ],
        mocks: [],
      })),
    ),
  });
};

let dir: string;
let baseId: string;
let headId: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-ac-internal-errors-python-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const write = (files: Record<string, string>) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
  };
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  write({ "src/math.ts": "export const a = 1;\nexport const b = 2;\n", [PY_PATH]: PY_BASE });
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  baseId = sh("rev-parse", "HEAD").trim();
  sh("checkout", "-q", "-b", "feature");
  write({ "src/math.ts": "export const a = 1;\nexport const b = 3;\n", [PY_PATH]: PY_HEAD });
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  headId = sh("rev-parse", "HEAD").trim();
  write({ "coverage/lcov.info": `SF:${dir}/src/math.ts\nDA:1,1\nDA:2,1\nend_of_record\n` });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function loadIndex(): Promise<IndexPythonTests> {
  const io = (await import("../../node-io/src/index.js")) as unknown as { indexPythonTests: IndexPythonTests };
  return io.indexPythonTests;
}

/** The Action over the repository, test-integrity block, with the Python index run through the given fake spawn. */
async function actionRun(spawn: Spawn) {
  const { run } = (await import("../src/run.js")) as unknown as { run(deps: never): Promise<unknown> };
  const { createNodeIo } = await import("../src/node-io.js");
  const indexPythonTests = await loadIndex();
  const h = harness({
    inputs: { "test-integrity": "block" },
    files: { [`${dir}/coverage/lcov.info`]: `SF:${dir}/src/math.ts\nDA:1,1\nDA:2,1\nend_of_record\n` },
    context: {
      ...PR_CONTEXT,
      payload: { pull_request: { number: 7, base: { sha: baseId }, head: { sha: headId } } },
    },
  });
  const io = createNodeIo(dir) as unknown as Record<string, unknown>;
  const deps = h.deps as unknown as Record<string, unknown>;
  deps.workspace = dir;
  deps.git = io.git;
  deps.gitStream = io.gitStream;
  if (io.gitBatch) deps.gitBatch = io.gitBatch;
  deps.listDir = io.listDir;
  let spawns = 0;
  deps.indexPython = (files: readonly PyFile[]) =>
    indexPythonTests(files, {
      spawn: (...args) => {
        spawns++;
        return spawn(...args);
      },
    });
  const result = await run(h.deps as never);
  const reports = Object.keys(h.written).filter((path) => path.endsWith("report.json"));
  return { h, result, reports, spawns };
}

/** The CLI over the repository, test-integrity block, JSON output, with the Python index run through the fake spawn. */
async function cliRun(spawn: Spawn) {
  const { main } = await import("../../cli/src/main.js");
  const { nodeDeps } = await import("../../cli/src/nodeDeps.js");
  const indexPythonTests = await loadIndex();
  const deps = nodeDeps(dir) as unknown as Record<string, unknown> & {
    stdout(text: string): void;
    stderr(text: string): void;
  };
  let stdout = "";
  let stderr = "";
  deps.stdout = (text) => {
    stdout += text;
  };
  deps.stderr = (text) => {
    stderr += text;
  };
  deps.indexPython = (files: readonly PyFile[]) => indexPythonTests(files, { spawn });
  const code = await main(
    ["check", "--format", "json", "--test-integrity", "block", "--base", baseId, "--coverage", "coverage/lcov.info"],
    deps as never,
  );
  return { code, stdout, stderr };
}

describe("the Action and the CLI: an exception from our own Python output mapping", () => {
  it("AC-7: a fault in the mapping of a valid Python raw output fails the Action step with a pharn-ci: message and the CLI with exit 2, with no report and no unavailable index; genuine run failures still give an unavailable index", async () => {
    // The Action, fault armed.
    fault.armed = true;
    fault.calls = 0;
    let action: Awaited<ReturnType<typeof actionRun>>;
    try {
      action = await actionRun(validRun);
    } finally {
      fault.armed = false;
    }
    expect(action.spawns, "the Python index ran through the fake spawn").toBeGreaterThan(0);
    expect(fault.calls, "the injected fault was reached through the Action").toBeGreaterThan(0);
    expect(action.h.failed, "the Action step failed once").toHaveLength(1);
    expect(action.h.failed[0], "with a pharn-ci: message").toMatch(/^pharn-ci: /);
    expect(action.h.failed[0], "naming the mapping's own error").toContain(fault.error.message);
    expect(action.result, "run() returned no report").toBeUndefined();
    expect(action.reports, "no report.json was written").toEqual([]);
    expect(action.h.summary, "no job summary was written").toEqual([]);
    expect(action.h.posted, "no comment was posted").toEqual([]);
    for (const line of [...action.h.infos, ...action.h.warnings]) {
      expect(line, "no log line says the Python index was unavailable").not.toMatch(UNAVAILABLE);
    }

    // The CLI, fault armed.
    fault.armed = true;
    fault.calls = 0;
    let cli: Awaited<ReturnType<typeof cliRun>>;
    try {
      cli = await cliRun(validRun);
    } finally {
      fault.armed = false;
    }
    expect(fault.calls, "the injected fault was reached through the CLI").toBeGreaterThan(0);
    expect(cli.code, "the CLI exits 2").toBe(2);
    expect(cli.stdout, "the CLI printed no report").toBe("");
    expect(cli.stderr, "with a pharn-ci: line").toMatch(/^pharn-ci: /m);
    expect(cli.stderr, "naming the mapping's own error").toContain(fault.error.message);
    expect(cli.stderr).not.toMatch(UNAVAILABLE);

    // Fault not armed: genuine run failures still give an unavailable index and a report, never a throw.
    const genuine: [label: string, result: SpawnResult, reason: RegExp][] = [
      [
        "the interpreter cannot start (EACCES)",
        outcome({ errorCode: "EACCES", exitCode: null }),
        /\((?!python-not-found)[a-z-]+\)/,
      ],
      ["the interpreter exits non-zero", outcome({ exitCode: 1, stderr: "Fatal error\n" }), /\(python-failed\)/],
      ["the output is not the expected shape", outcome({ stdout: '{"hello": "world"}' }), /\(bad-output\)/],
    ];
    for (const [label, result, reason] of genuine) {
      const r = await actionRun(async () => result);
      expect(r.spawns, `${label}: the Python index ran`).toBeGreaterThan(0);
      expect(r.result, `${label}: run() returned a report`).toBeDefined();
      expect(r.reports, `${label}: report.json was written`).toHaveLength(1);
      const lines = r.h.infos.filter((line) => UNAVAILABLE.test(line));
      expect(lines, `${label}: one unavailable line`).toHaveLength(1);
      expect(lines[0], `${label}: names the reason`).toMatch(reason);
      for (const failed of r.h.failed)
        expect(failed, `${label}: no thrown error failed the step`).not.toContain("AC-7");
    }
  }, 120_000);
});
