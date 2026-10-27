import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// E3 item 24 (P07), AC-18. main() and nodeDeps() are loaded inside the test body: the AC test is written before the CLI
// reads the agent instruction files, so nothing the build adds may run while this file loads. It runs the CLI with its
// real Node deps on a temporary git repository, as packages/cli/test/ac-secrets-cli.test.ts does, and observes every
// git batch call by wrapping gitBatch (which can also be made to fail for the instruction call).

interface Deps {
  git(args: string[]): Promise<string>;
  gitBatch?(args: string[], input: string): Promise<Uint8Array>;
  stdout(text: string): void;
  stderr(text: string): void;
}
type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = Record<string, unknown> & { messages: Message[]; policy?: { violations: Violation[] } };
type BatchCall = { args: string[]; input: string };

const POLICY_PATH = "policy/org.json";
const LOG_PREFIX = "pharn-ci: could not read the agent instruction files from git, so P07 did not compare them: ";
let dir: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-p07-cli-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 2;\n");
  writeFileSync(join(dir, "AGENTS.md"), "# Agents\n\nRun `pnpm install`.\n");
  writeFileSync(join(dir, "CLAUDE.md"), "# Claude\n\nRun `npm install`.\n");
  mkdirSync(join(dir, "policy"));
  writeFileSync(join(dir, POLICY_PATH), JSON.stringify({ version: 1 }));
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 3;\nexport const c = 4;\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  mkdirSync(join(dir, "coverage"));
  writeFileSync(join(dir, "coverage/lcov.info"), `SF:${dir}/src/math.ts\nDA:1,1\nDA:2,1\nDA:3,1\nend_of_record\n`);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function runCli(extra: string[], failInstructions = false) {
  const { main } = await import("../src/main.js");
  const { nodeDeps } = await import("../src/nodeDeps.js");
  const deps = nodeDeps(dir) as unknown as Deps;
  const calls: BatchCall[] = [];
  const realBatch = deps.gitBatch;
  expect(realBatch, "the CLI's deps carry a batch git runner").toBeDefined();
  deps.gitBatch = (args, input) => {
    calls.push({ args: [...args], input });
    if (failInstructions && input.includes("HEAD:AGENTS.md")) {
      return Promise.reject(new Error("fatal: simulated failure"));
    }
    return (realBatch as NonNullable<Deps["gitBatch"]>)(args, input);
  };
  let out = "";
  let err = "";
  deps.stdout = (text) => {
    out += text;
  };
  deps.stderr = (text) => {
    err += text;
  };
  const code = await main(
    ["check", "--base", "main", "--coverage", "coverage/lcov.info", ...extra, "--format", "json"],
    deps as never,
  );
  expect(out, `exit ${code}, stderr: ${err}`).not.toBe("");
  const report = JSON.parse(out) as Report;
  expectValidReport(report);
  return { code, report, err, calls };
}

const p07 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P07");
const namingInstructions = (calls: BatchCall[]) => calls.filter((c) => /:(AGENTS|CLAUDE)\.md$/m.test(c.input));

describe("pharn-ci check: P07 under --policy-file", { timeout: 120_000 }, () => {
  it("AC-18: with --policy-file the CLI reports two warn P07 violations with their lines; without it nothing is read and no policy object appears; a failing instruction read gives one info violation and one stderr line", async () => {
    const withPolicy = await runCli(["--policy-file", POLICY_PATH]);
    expect(withPolicy.report.policy, "the policy file was applied").toBeDefined();
    expect(p07(withPolicy.report).map((v) => ({ path: v.path, line: v.line, severity: v.severity }))).toEqual([
      { path: "AGENTS.md", line: 3, severity: "warn" },
      { path: "CLAUDE.md", line: 3, severity: "warn" },
    ]);

    const without = await runCli([]);
    expect(without.report.policy).toBeUndefined();
    expect(p07(without.report)).toEqual([]);
    expect(without.report.messages.filter((m) => m.code === "POLICY_P07")).toEqual([]);
    expect(namingInstructions(without.calls)).toEqual([]);

    const failing = await runCli(["--policy-file", POLICY_PATH], true);
    expect(namingInstructions(failing.calls).length).toBeGreaterThan(0);
    expect(p07(failing.report).map((v) => ({ path: v.path, line: v.line, severity: v.severity }))).toEqual([
      { path: null, line: null, severity: "info" },
    ]);
    const lines = failing.err.split("\n").filter((l) => l.startsWith(LOG_PREFIX));
    expect(lines, failing.err).toHaveLength(1);
  });
});
