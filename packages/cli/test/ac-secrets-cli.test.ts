import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// main() and nodeDeps() are loaded inside the test body: the test is written before the CLI gathers agent config
// sources, so nothing that depends on that may run while the file loads. It runs the CLI with its real Node deps on
// temporary git repositories, as packages/cli/test/ac-test-sources-cli.test.ts does, and observes every git call by
// wrapping git and gitBatch.
//
// No complete secret is written in this file (gitleaks, GitHub push protection, and AC-22 runs findSecretSpans over
// this file as committed): the secret is assembled at test time from a prefix and a run cut from ALPHABET.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** `n` distinct characters of ALPHABET, stepping 7 places from `seed` (7 is coprime with 62). */
function cut(n: number, seed: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[(seed + i * 7) % ALPHABET.length];
  return s;
}

interface Deps {
  git(args: string[]): Promise<string>;
  gitBatch?(args: string[], input: string): Promise<Uint8Array>;
  stdout(text: string): void;
  stderr(text: string): void;
}
type Report = { verdict: string; messages: { level: string; code: string; text: string }[] };

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A repository whose base commit holds src/math.ts and `files`, and whose feature branch changes src/math.ts only
 * (no test file, so the test sources select nothing), with an lcov file covering every changed line.
 */
function repo(files: Record<string, string>): string {
  // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-secrets-cli-")));
  dirs.push(dir);
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 2;\n");
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 3;\nexport const c = 4;\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  mkdirSync(join(dir, "coverage"));
  writeFileSync(join(dir, "coverage/lcov.info"), `SF:${dir}/src/math.ts\nDA:1,1\nDA:2,1\nDA:3,1\nend_of_record\n`);
  return dir;
}

async function runCli(dir: string, format: string[]) {
  const { main } = await import("../src/main.js");
  const { nodeDeps } = await import("../src/nodeDeps.js");
  const deps = nodeDeps(dir) as unknown as Deps;
  const calls: string[][] = [];
  const realGit = deps.git;
  deps.git = (args) => {
    calls.push([...args]);
    return realGit(args);
  };
  const realBatch = deps.gitBatch;
  if (realBatch) {
    deps.gitBatch = (args, input) => {
      calls.push([...args]);
      return realBatch(args, input);
    };
  }
  let out = "";
  deps.stdout = (text) => {
    out += text;
  };
  deps.stderr = () => {};
  const code = await main(["check", "--base", "main", "--coverage", "coverage/lcov.info", ...format], deps as never);
  return { code, out, calls };
}

const catFile = (calls: string[][]) => calls.filter((args) => args[0] === "cat-file");

describe("pharn-ci check: agent config secrets", () => {
  it("AC-18: a committed .mcp.json secret fails with AGENT_CONFIG_SECRET_S01 and never prints the secret; a repo with no scannable path makes no cat-file call", async () => {
    const secret = "ghp" + "_" + cut(36, 11);
    const withSecret = repo({
      ".mcp.json": `{\n  "mcpServers": {\n    "github": { "env": { "GITHUB_TOKEN": "${secret}" } }\n  }\n}\n`,
    });

    const json = await runCli(withSecret, ["--format", "json"]);
    expect(json.code, "json: exit code").toBe(1);
    const report = JSON.parse(json.out) as Report;
    expect(report.messages.filter((m) => m.code === "AGENT_CONFIG_SECRET_S01").map((m) => m.level)).toEqual(["error"]);
    expect(json.out.includes(secret), "json output holds no secret").toBe(false);

    const markdown = await runCli(withSecret, []);
    expect(markdown.code, "markdown: exit code").toBe(1);
    expect(markdown.out).toContain("AGENT_CONFIG_SECRET_S01");
    expect(markdown.out.includes(secret), "markdown output holds no secret").toBe(false);

    const plain = repo({ "README.md": "# demo\n" });
    for (const format of [["--format", "json"], []]) {
      const run = await runCli(plain, format);
      const label = format.length === 0 ? "markdown" : "json";
      expect(catFile(run.calls), `${label}: no cat-file call`).toEqual([]);
      expect(run.out.includes("AGENT_CONFIG_SECRET_"), `${label}: no A7 message`).toBe(false);
      if (format.length > 0) {
        const plainReport = JSON.parse(run.out) as Report;
        expect(plainReport.messages.filter((m) => m.code.startsWith("AGENT_CONFIG_SECRET_"))).toEqual([]);
      }
    }
  }, 60_000);
});
