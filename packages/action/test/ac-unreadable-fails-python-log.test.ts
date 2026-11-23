import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harness, PR_CONTEXT } from "./harness.js";

// CORE-69. run() and createNodeIo() are loaded inside the test body: the AC test is written before a missing python3
// with a modified `.py` test file stops TI02 and TI05 for the whole run, so nothing the build changes may run while the
// file loads. Git is real (one temporary repository whose feature commit removes a test from tests/test_c.py); the
// Python index is an injected fake that reports python-not-found, so the test needs no python3.

const PY_PATH = "tests/test_c.py";
const PY_BASE =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n\n\ndef test_empty():\n    assert total([]) == 0\n";
const PY_HEAD = "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n";

let dir: string;
let baseId: string;
let headId: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-core69-python-log-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "tests"));
  writeFileSync(join(dir, "src/cart.py"), "def total(xs):\n    return sum(xs)\n");
  writeFileSync(join(dir, PY_PATH), PY_BASE);
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  baseId = sh("rev-parse", "HEAD").trim();
  sh("checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, PY_PATH), PY_HEAD);
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  headId = sh("rev-parse", "HEAD").trim();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("action: the log line when no Python interpreter was found for a modified Python test file", () => {
  it("AC-20: the info log holds one line naming python-not-found that says TI02 and TI05 did not run, and no line saying only .py test files are not compared", async () => {
    const { run } = await import("../src/run.js");
    const { createNodeIo } = await import("../src/node-io.js");
    const h = harness({
      inputs: { "test-integrity": "block" },
      files: { [`${dir}/coverage/lcov.info`]: `SF:${dir}/src/cart.py\nDA:1,1\nDA:2,1\nend_of_record\n` },
      context: {
        ...PR_CONTEXT,
        payload: { pull_request: { number: 7, base: { sha: baseId }, head: { sha: headId } } },
      },
    });
    const io = createNodeIo(dir);
    const deps = h.deps;
    deps.workspace = dir;
    deps.git = io.git;
    deps.gitStream = io.gitStream;
    if (io.gitBatch) deps.gitBatch = io.gitBatch;
    deps.listDir = io.listDir;
    let pythonCalls = 0;
    deps.indexPython = async () => {
      pythonCalls++;
      return { available: false, reason: "python-not-found", detail: "spawn python3 ENOENT" };
    };
    await run(h.deps as never);

    expect(pythonCalls, "the Python index ran").toBeGreaterThan(0);
    const named = h.infos.filter((line) => line.includes("python-not-found"));
    expect(named, "one info line names python-not-found").toHaveLength(1);
    expect(named[0], "it says TI02 and TI05 did not run").toContain("TI02 and TI05 did not run");
    expect(
      h.infos.filter((line) => line.includes(".py test files are not compared")),
      "no line says only .py test files are not compared",
    ).toEqual([]);
  }, 60_000);
});
