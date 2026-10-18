import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// main() and nodeDeps() are loaded inside each test body, like the other AC tests written before the build. Each
// test builds a real git repo in a temp directory with coverage/lcov.info on disk, then removes it.
//
// Each test first runs once with no coverage path set and checks that coverage/lcov.info IS discovered there. That
// control run is what gives the explicit runs their meaning: the same candidate is on disk and discoverable, yet
// an explicit --coverage or coverage.file wins over it and is reported exactly as before.

const TIMEOUT_MS = 120_000;

function makeRepo() {
  // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-discovery-explicit-")));
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

/** The control run: no coverage path set, so coverage/lcov.info is discovered. */
async function expectDiscovered(dir: string, argv: string[]) {
  const run = await runCli(dir, argv);
  expect(run.code, `control run: ${run.stderr}`).toBe(0);
  expect(run.stderr, "control run").toContain("coverage: coverage/lcov.info (auto-discovered)");
}

/** An explicit run naming missing.info: reported as today, and no discovery. */
function expectExplicitMissing(label: string, run: { stdout: string; stderr: string }) {
  const report = JSON.parse(run.stdout);
  expectValidReport(report);
  const missing = report.messages.filter((message: { code: string }) => message.code === "COVERAGE_FILE_MISSING");
  expect(missing, label).toHaveLength(1);
  expect(missing[0].text, label).toContain("missing.info");
  expect(missing[0].text, label).not.toContain("coverage/lcov.info");
  expect(report.diffCoverage, label).toBeNull();
  expect(run.stderr, label).not.toContain("(auto-discovered)");
}

describe("pharn-ci check with an explicit coverage path while a candidate is on disk", () => {
  it(
    "AC-11: --coverage missing.info wins over the discoverable coverage/lcov.info",
    async () => {
      const repo = makeRepo();
      try {
        const argv = ["check", "--format", "json", "--base", repo.base];
        await expectDiscovered(repo.dir, argv);
        expectExplicitMissing("--coverage", await runCli(repo.dir, [...argv, "--coverage", "missing.info"]));
      } finally {
        repo.remove();
      }
    },
    TIMEOUT_MS,
  );

  it(
    "AC-11: coverage.file: missing.info in .pharn/ci.yml wins over the discoverable coverage/lcov.info",
    async () => {
      const repo = makeRepo();
      try {
        const argv = ["check", "--format", "json", "--base", repo.base];
        await expectDiscovered(repo.dir, argv);
        mkdirSync(join(repo.dir, ".pharn"));
        writeFileSync(join(repo.dir, ".pharn/ci.yml"), "coverage:\n  file: missing.info\n");
        expectExplicitMissing("coverage.file", await runCli(repo.dir, argv));
      } finally {
        repo.remove();
      }
    },
    TIMEOUT_MS,
  );
});
