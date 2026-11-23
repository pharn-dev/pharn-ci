import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// CORE-351 (AC-7). gatherSources is loaded inside the test body: the AC test is written before the log line about an
// unavailable Python index says that it fails the run in mode block, so nothing the build changes may run while the
// file loads. Git is real (one temporary repository whose feature commit modifies tests/test_c.py); the Python indexer
// is an injected fake that returns an unavailable run, so the test needs no python3.

const PY_PATH = "tests/test_c.py";
const PY_BASE =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n\n\ndef test_empty():\n    assert total([]) == 0\n";
const PY_HEAD = "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n";

let dir: string;
let baseId: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-core351-log-")));
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
}, 60_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("CORE-351: the log line when the Python index is unavailable", () => {
  it.each(["python-too-old", "python-failed", "timeout", "output-too-large", "bad-output"] as const)(
    "AC-7: with the Python indexer unavailable as %s, the one log line about the Python index names the reason, says the .py test files are not compared, and says this fails the run in mode block",
    async (reason) => {
      const io = await import("../src/index.js");
      const lines: string[] = [];
      let pythonCalls = 0;
      const deps = {
        git: (args: string[]) => io.runGit(dir, args),
        gitBatch: (args: string[], input: string) => io.runGitBatch(dir, args, input),
        indexPython: async () => {
          pythonCalls++;
          return { available: false as const, reason, detail: "the fake indexer did not run" };
        },
      };
      await io.gatherSources(deps, {
        diff: { parsed: [{ path: PY_PATH, oldPath: PY_PATH, status: "modified", addedLines: [], removedCount: 4 }] },
        revisions: io.runRevisions(deps, baseId),
        checkout: "head",
        repoFiles: [PY_PATH, "src/cart.py"],
        testIntegrityMode: { input: "block" },
        dependencySettings: undefined,
        policy: undefined,
        log: (line) => lines.push(line),
        warn: (line) => lines.push(line),
      });

      expect(pythonCalls, "the Python indexer ran").toBeGreaterThan(0);
      const about = lines.filter((line) => /python/i.test(line));
      expect(about, "one log line about the Python index").toHaveLength(1);
      const line = about[0] ?? "";
      expect(line, "it names the reason").toContain(reason);
      expect(line, "it says the .py test files are not compared").toContain(".py test files are not compared");
      expect(line, "it says this fails the run in mode block").toMatch(/fails the run in mode `?block`?/);
    },
    60_000,
  );
});
