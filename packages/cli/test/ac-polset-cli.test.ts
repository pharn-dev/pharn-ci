import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// E3 item 23 (policy settings), AC-27. main() and nodeDeps() are loaded inside the test body: the AC test is written
// before the CLI reads the agent settings files, so nothing that depends on that may run while this file loads. It
// runs the CLI with its real Node deps on temporary git repositories and observes every git call by wrapping git and
// gitBatch, as packages/cli/test/ac-secrets-cli.test.ts does.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
interface Deps {
  git(args: string[]): Promise<string>;
  gitBatch?(args: string[], input: string): Promise<Uint8Array>;
  stdout(text: string): void;
  stderr(text: string): void;
}
type Call = { args: string[]; input?: string };

const NEW_CODES = ["POLICY_P02", "POLICY_P03", "POLICY_P04", "POLICY_P05", "POLICY_P06", "POLICY_SETTINGS_INVALID"];
const POLICY = {
  version: 1,
  setup: { forbidden_permissions: ["Bash(curl:*)"], required_permissions_deny: ["Bash(rm -rf:*)"] },
};
const NESTED = "pkg/.claude/settings.json";
const NESTED_COMMITTED = [
  "{",
  '  "permissions": {',
  '    "allow": [',
  '      "Bash(git status)",',
  '      "Bash(curl:*)"',
  "    ]",
  "  }",
  "}",
  "",
].join("\n");
const NESTED_LINE = 5;
const UNREAD = "git ls-tree failed, so symbolic links among the agent settings files could not be told apart";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository whose base commit holds `files` and the policy, a feature commit, and an lcov file. */
function repo(files: Record<string, string>): { dir: string; put: (path: string, text: string) => void } {
  // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-polset-cli-")));
  dirs.push(dir);
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  put("src/math.ts", "export const a = 1;\nexport const b = 2;\n");
  put("policy/org.json", `${JSON.stringify(POLICY, null, 2)}\n`);
  for (const [path, text] of Object.entries(files)) put(path, text);
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", "feature");
  put("src/math.ts", "export const a = 1;\nexport const b = 3;\nexport const c = 4;\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  put("coverage/lcov.info", `SF:${dir}/src/math.ts\nDA:1,1\nDA:2,1\nDA:3,1\nend_of_record\n`);
  return { dir, put };
}

async function runCli(dir: string, policy: boolean, failLsTree = false) {
  const { main } = await import("../src/main.js");
  const { nodeDeps } = await import("../src/nodeDeps.js");
  const deps = nodeDeps(dir) as unknown as Deps;
  const calls: Call[] = [];
  const realGit = deps.git;
  deps.git = (args) => {
    calls.push({ args: [...args] });
    if (failLsTree && args.includes("ls-tree")) return Promise.reject(new Error("fatal: not a tree object"));
    return realGit(args);
  };
  const realBatch = deps.gitBatch;
  if (realBatch) {
    deps.gitBatch = (args, input) => {
      calls.push({ args: [...args], input });
      return realBatch(args, input);
    };
  }
  let out = "";
  let err = "";
  deps.stdout = (text) => {
    out += text;
  };
  deps.stderr = (text) => {
    err += text;
  };
  const args = ["check", "--base", "main", "--coverage", "coverage/lcov.info", "--format", "json"];
  const code = await main([...args, ...(policy ? ["--policy-file", "policy/org.json"] : [])], deps as never);
  expect(code, err).not.toBe(2);
  const report = JSON.parse(out) as Report;
  expectValidReport(report);
  return { report, calls, err };
}

const subcommand = (args: string[]) => args.find((a) => !a.startsWith("-")) ?? "";
const naming = (calls: Call[], path: string) =>
  calls.filter((c) => c.args[0] === "cat-file" && (c.input ?? "").includes(path));
const newCodes = (report: Report) => report.messages.filter((m) => NEW_CODES.includes(m.code));

describe("pharn-ci check: policy mode reads the committed agent settings files", () => {
  it("AC-27: the committed nested file (not the working tree) gives P02, only ls-tree, cat-file and the no-policy run's subcommands are called, no policy reads nothing, no file reads nothing more, and an ls-tree failure is said on stderr", async () => {
    const { dir, put } = repo({
      ".claude/settings.json": '{ "permissions": { "allow": ["Bash(ls)"] } }\n',
      [NESTED]: NESTED_COMMITTED,
    });
    // The working tree differs: no violating allow entry, and a root deny that would satisfy P03.
    put(NESTED, '{ "permissions": { "allow": [] } }\n');
    put(".claude/settings.json", '{ "permissions": { "deny": ["Bash(rm -rf:*)"] } }\n');

    const withPolicy = await runCli(dir, true);
    const violations = withPolicy.report.policy?.violations ?? [];
    expect(violations.filter((v) => v.id === "P02")).toEqual([
      {
        id: "P02",
        severity: "block",
        path: NESTED,
        line: NESTED_LINE,
        detail: "allow rule overlaps forbidden permission Bash(curl:*)",
      },
    ]);
    // Each settings unit is judged on its own and a nested unit gets no fallback from the root (SPEC § Locations and
    // units), so the committed nested file, which has no deny list, misses the required deny rule too. The first run's
    // test expected only the root unit's finding, which disagreed with the SPEC; fixed when the PR was prepared.
    expect(violations.filter((v) => v.id === "P03").map((v) => [v.path, v.line, v.detail])).toEqual([
      [".claude/settings.json", null, "required deny rule Bash(rm -rf:*) is missing"],
      [NESTED, null, "required deny rule Bash(rm -rf:*) is missing"],
    ]);

    const withoutPolicy = await runCli(dir, false);
    const allowed = new Set([...withoutPolicy.calls.map((c) => subcommand(c.args)), "ls-tree", "cat-file"]);
    for (const call of withPolicy.calls) {
      expect(allowed.has(subcommand(call.args)), `git ${call.args.join(" ")} is an allowed call`).toBe(true);
    }
    expect(naming(withPolicy.calls, NESTED).length, "control: the policy run reads the nested file").toBeGreaterThan(0);
    expect(naming(withoutPolicy.calls, NESTED), "no policy: no cat-file request names the nested file").toEqual([]);
    expect("policy" in withoutPolicy.report, "no policy: no policy object").toBe(false);
    expect(newCodes(withoutPolicy.report)).toEqual([]);

    // A policy and no agent settings file: nothing more is read, and the root unit's P03 sits at .claude/settings.json.
    const empty = repo({ "README.md": "# demo\n" }).dir;
    const emptyWith = await runCli(empty, true);
    const emptyWithout = await runCli(empty, false);
    expect(emptyWith.calls.length, "no more git calls than without a policy").toBeLessThanOrEqual(
      emptyWithout.calls.length,
    );
    expect((emptyWith.report.policy?.violations ?? []).filter((v) => v.id === "P03")).toEqual([
      {
        id: "P03",
        severity: "block",
        path: ".claude/settings.json",
        line: null,
        detail: "required deny rule Bash(rm -rf:*) is missing",
      },
    ]);

    // git ls-tree fails: symlinks cannot be told apart, so nothing is read and stderr says why.
    const failed = await runCli(dir, true, true);
    expect(failed.err).toContain(
      `pharn-ci: could not read the agent settings files from git, so they are not checked against the org policy: ${UNREAD}\n`,
    );
    expect(failed.report.messages.filter((m) => m.code === "POLICY_SETTINGS_INVALID")).toEqual([
      {
        level: "warn",
        code: "POLICY_SETTINGS_INVALID",
        text: `The agent settings files were not read (${UNREAD}), so P02–P06 did not run.`,
      },
    ]);
    expect(naming(failed.calls, NESTED), "ls-tree failed: the nested file is not read").toEqual([]);
  }, 120_000);
});
