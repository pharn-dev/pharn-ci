import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import { nodeDeps } from "../src/nodeDeps.js";

// CORE-39: in a CI job the CLI's stderr is the job log, which the runner reads line by line for workflow commands
// (`::command::data` at the start of a line after its leading whitespace, `##[command]data` anywhere in one). A
// tracked directory whose name holds a newline reaches stderr through coverage auto-discovery; it must not start a
// command. The test builds a real git repo whose second commit tracks the directory and its coverage report.

const TIMEOUT_MS = 120_000;
const COBERTURA = readFileSync(new URL("../../../fixtures/golden-cobertura/coverage.xml", import.meta.url), "utf8");

function makeRepo(files: Record<string, string>) {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-log-escape-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/a.ts"), "export const a1 = 1;\n");
  sh("add", ".");
  sh("commit", "-q", "-m", "base");
  const base = sh("rev-parse", "HEAD").trim();
  writeFileSync(join(dir, "src/a.ts"), "export const a1 = 1;\nexport const a2 = 2;\n");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  sh("add", ".");
  sh("commit", "-q", "-m", "change");
  return { dir, base, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

async function runCli(cwd: string, argv: string[]) {
  const deps = nodeDeps(cwd);
  let err = "";
  deps.stdout = () => {};
  deps.stderr = (text: string) => {
    err += text;
  };
  const code = await main(argv, deps);
  return { code, stderr: err };
}

/** The lines the runner reads from the text: \n, \r and \r\n each end one. */
const runnerLines = (text: string) => text.split(/\r\n|\r|\n/);

function expectNoCommandLine(stderr: string) {
  for (const line of runnerLines(stderr)) {
    expect(line.trimStart().startsWith("::"), line).toBe(false);
    expect(line.trimStart().startsWith("##["), line).toBe(false);
    expect(line.includes("##["), line).toBe(false);
  }
}

const CASES = [
  {
    spelling: "::stop-commands::",
    dir: "pkg\n::stop-commands::tok\n",
    shown: "coverage: pkg�::stop-commands::tok�/coverage.cobertura.xml (auto-discovered)",
  },
  {
    spelling: "##[add-mask] (the older command spelling)",
    dir: "pkg\r\n##[add-mask]x",
    shown: "coverage: pkg��##\\[add-mask]x/coverage.cobertura.xml (auto-discovered)",
  },
] as const;

describe("pharn-ci check: a tracked path that holds a workflow command after a newline", () => {
  it.each(CASES)(
    "writes no stderr line that starts a command, with $spelling in the path",
    async ({ dir, shown }) => {
      const repo = makeRepo({ [`${dir}/coverage.cobertura.xml`]: COBERTURA });
      try {
        const run = await runCli(repo.dir, ["check", "--format", "json", "--base", repo.base]);
        expect(run.code, run.stderr).not.toBe(2);
        expectNoCommandLine(run.stderr);
        // The line still names the path, with each control character replaced by U+FFFD.
        expect(runnerLines(run.stderr)).toContain(shown);
      } finally {
        repo.remove();
      }
    },
    TIMEOUT_MS,
  );

  it(
    "escapes an error message on stderr too: an ambiguous discovery that names the path",
    async () => {
      const repo = makeRepo({
        "pkg\n::stop-commands::tok\n/coverage.cobertura.xml": COBERTURA,
        "pkg\r\n##[add-mask]x/coverage.cobertura.xml": COBERTURA,
        "coverage.xml": COBERTURA,
      });
      try {
        const run = await runCli(repo.dir, ["check", "--format", "json", "--base", repo.base]);
        expect(run.code).toBe(2);
        expect(run.stderr).toContain("found more than one coverage report");
        expectNoCommandLine(run.stderr);
      } finally {
        repo.remove();
      }
    },
    TIMEOUT_MS,
  );
});
