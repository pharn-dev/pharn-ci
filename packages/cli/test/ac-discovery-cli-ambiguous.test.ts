import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// main() and nodeDeps() are loaded inside the test body, like the other AC tests written before the build. The
// test builds a real git repo in a temp directory, with no coverage path set and two different discovery
// candidates written to disk after the commits, then removes it.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const TIMEOUT_MS = 120_000;

function makeRepo() {
  // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-discovery-ambiguous-")));
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
  writeFileSync(join(dir, "coverage.xml"), fixture("golden-cobertura/coverage.xml"));
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

describe("pharn-ci check with no coverage path and two different candidates on disk", () => {
  it(
    "AC-9: exits 2 with nothing on stdout, and stderr names both found files and --coverage",
    async () => {
      const repo = makeRepo();
      try {
        const run = await runCli(repo.dir, ["check", "--base", repo.base]);
        expect(run.code, run.stderr).toBe(2);
        expect(run.stdout).toBe("");
        expect(run.stderr).toContain("coverage/lcov.info");
        expect(run.stderr).toContain("coverage.xml");
        expect(run.stderr).toContain("--coverage");
        expect(run.stderr).not.toContain("(auto-discovered)");
      } finally {
        repo.remove();
      }
    },
    TIMEOUT_MS,
  );
});
