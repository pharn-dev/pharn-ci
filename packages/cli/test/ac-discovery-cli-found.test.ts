import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// main() and nodeDeps() are loaded inside the test body, like the other AC tests written before the build. The
// test builds a real git repo in a temp directory, with no .pharn/ci.yml and no --coverage flag, and an untracked
// coverage/lcov.info written to disk after the commits, then removes it.

const TIMEOUT_MS = 120_000;

/** A repo whose base commit tracks AGENTS.md, README.md and src/a.ts, and whose second commit adds two lines. */
function makeRepo() {
  // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-discovery-found-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "AGENTS.md"), "# Agents\n");
  writeFileSync(join(dir, "README.md"), "# Demo\n");
  writeFileSync(join(dir, "src/a.ts"), "export const a1 = 1;\n");
  sh("add", ".");
  sh("commit", "-q", "-m", "base");
  const base = sh("rev-parse", "HEAD").trim();
  writeFileSync(join(dir, "src/a.ts"), "export const a1 = 1;\nexport const a2 = 2;\nexport const a3 = 3;\n");
  sh("add", ".");
  sh("commit", "-q", "-m", "change");
  mkdirSync(join(dir, "coverage"));
  writeFileSync(join(dir, "coverage/lcov.info"), `SF:${dir}/src/a.ts\nDA:1,1\nDA:2,1\nDA:3,1\nend_of_record\n`);
  return { dir, base, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

async function runCli(cwd: string, argv: string[]) {
  const { main } = await import("../src/main.js");
  const { nodeDeps } = await import("../src/nodeDeps.js");
  const deps = nodeDeps(cwd);
  let out = "";
  let err = "";
  deps.stdout = (text: string) => {
    out += text;
  };
  deps.stderr = (text: string) => {
    err += text;
  };
  const code = await main(argv, deps);
  return { code, stdout: out, stderr: err };
}

const lines = (text: string) => text.split(/\r?\n/).map((line) => line.trimEnd());

describe("pharn-ci check with no coverage path and coverage/lcov.info on disk", () => {
  it(
    "AC-8: discovers coverage/lcov.info from the repo root and from a subdirectory, and measures from it",
    async () => {
      const repo = makeRepo();
      try {
        for (const cwd of [repo.dir, join(repo.dir, "src")]) {
          const run = await runCli(cwd, ["check", "--format", "json", "--base", repo.base]);
          expect(run.code, `${cwd}: ${run.stderr}`).toBe(0);
          expect(lines(run.stderr), cwd).toContain("coverage: coverage/lcov.info (auto-discovered)");
          const report = JSON.parse(run.stdout);
          expectValidReport(report);
          expect(report.diffCoverage, cwd).not.toBeNull();
          expect(report.diffCoverage.format, cwd).toBe("lcov");
        }
      } finally {
        repo.remove();
      }
    },
    TIMEOUT_MS,
  );
});
