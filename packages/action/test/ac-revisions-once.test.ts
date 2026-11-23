import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PythonIndexRun } from "../../core/src/index.js";
import * as io from "../../node-io/src/index.js";

// CORE-143 item 3: one run resolves the base, HEAD and their merge base once and passes them on. The CLI and the Action
// run on a real temporary repository whose change touches every reader of the merge base: the config in use, a test
// file, a manifest (dependency safety and the stale-instruction manifests) and an agent settings file (P13, under a file
// policy). git is wrapped to record its calls.

let dir: string;
let baseSha: string;
let headSha: string;

function put(path: string, text: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-revisions-once-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  put(".pharn/ci.yml", "coverage:\n  threshold: 0\n");
  put("src/math.ts", "export const add = (a: number, b: number) => a + b;\n");
  put("src/math.test.ts", 'import { add } from "./math";\ntest("add", () => {\n  expect(add(1, 2)).toBe(3);\n});\n');
  put("package.json", `${JSON.stringify({ name: "demo", scripts: { test: "vitest" } }, null, 2)}\n`);
  put("AGENTS.md", "# Agents\n\nRun `npm test`.\n");
  put(".claude/settings.json", `${JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }, null, 2)}\n`);
  put("policy/org.json", `${JSON.stringify({ version: 1, setup: { forbidden_permissions: ["Bash(curl:*)"] } })}\n`);
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  baseSha = sh("rev-parse", "HEAD");
  put(".pharn/ci.yml", "coverage:\n  threshold: 10\n");
  put(
    "src/math.ts",
    "export const add = (a: number, b: number) => a + b;\nexport const sub = (a: number, b: number) => a - b;\n",
  );
  put(
    "src/math.test.ts",
    'import { add } from "./math";\ntest("add", () => {\n  expect(add(1, 2)).toBe(3);\n  expect(add(2, 2)).toBe(4);\n});\n',
  );
  put("package.json", `${JSON.stringify({ name: "demo", scripts: { test: "vitest", lint: "biome" } }, null, 2)}\n`);
  put(".claude/settings.json", `${JSON.stringify({ permissions: { allow: ["Bash(ls)", "Bash(cat)"] } }, null, 2)}\n`);
  sh("add", "-A");
  sh("commit", "-q", "-m", "head");
  headSha = sh("rev-parse", "HEAD");
  // Not committed: the coverage report the test step wrote.
  put("coverage/lcov.info", "SF:src/math.ts\nDA:1,1\nDA:2,1\nend_of_record\n");
}, 60_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const noPython = async (): Promise<PythonIndexRun> => ({
  available: false,
  reason: "python-not-found",
  detail: "python3 was not found",
});

/** git in the repository, with every call recorded. */
function recordingGit(calls: string[][]) {
  return (args: string[]) => {
    calls.push([...args]);
    return io.runGit(dir, args);
  };
}

/** How many calls resolved each revision and how many asked for a merge base. */
function revisionCalls(calls: string[][], base: string) {
  const revParse = (revision: string) =>
    calls.filter((args) => args[0] === "rev-parse" && args.at(-1) === `${revision}^{commit}`).length;
  return {
    base: revParse(base),
    head: revParse("HEAD"),
    mergeBase: calls.filter((args) => args[0] === "merge-base").length,
  };
}

async function cliRun(base: string): Promise<string[][]> {
  const { main } = await import("../../cli/src/main.js");
  const { nodeDeps } = await import("../../cli/src/nodeDeps.js");
  const calls: string[][] = [];
  let stderr = "";
  const deps = {
    ...nodeDeps(dir),
    git: recordingGit(calls),
    indexPython: noPython,
    stdout: () => {},
    stderr: (text: string) => {
      stderr += text;
    },
  };
  const args = ["check", "--base", base, "--coverage", "coverage/lcov.info", "--format", "json"];
  const code = await main([...args, "--policy-file", "policy/org.json"], deps);
  expect(code, stderr).not.toBe(2);
  return calls;
}

async function actionRun(base: string): Promise<string[][]> {
  const { run } = await import("../src/run.js");
  const calls: string[][] = [];
  const inputs: Record<string, string> = {
    "coverage-file": "coverage/lcov.info",
    "base-ref": base,
    policy: "file:policy/org.json",
    upload: "never",
    comment: "false",
    "fail-on-verdict": "false",
  };
  const failed: string[] = [];
  const refuse = async () => {
    throw new Error("no GitHub API in this test");
  };
  await run({
    getInput: (name) => inputs[name] ?? "",
    context: { eventName: "push", sha: headSha, payload: {} },
    workspace: dir,
    tempDir: join(dir, ".tmp-runner"),
    api: {
      compareDiff: refuse,
      getPullRequest: refuse,
      getPullRequestSignoff: refuse,
      listPullRequestCommits: refuse,
      listIssueEvents: refuse,
      listTree: refuse,
      viewerLogin: async () => null,
      listComments: refuse,
      createComment: refuse,
      updateComment: refuse,
      deleteComment: refuse,
    },
    git: recordingGit(calls),
    gitStream: (args) => io.streamGit(dir, args),
    gitBatch: (args, input) => io.runGitBatch(dir, args, input),
    indexPython: noPython,
    readFile: (path) => io.readFile(path),
    readFileStream: (path) => io.readFileStream(path),
    listDir: (path) => io.listDir(path),
    lstat: io.lstatPath,
    writeFile: async () => {},
    resolvePath: (...segments) => resolve(...segments),
    info: () => {},
    warning: () => {},
    setOutput: () => {},
    setFailed: (message) => failed.push(message),
    writeSummary: async () => {},
  });
  expect(failed).toEqual([]);
  return calls;
}

describe("CORE-143: one run resolves the base, HEAD and their merge base once", { timeout: 120_000 }, () => {
  it("the CLI: rev-parse once for the base and once for HEAD, merge-base once", async () => {
    expect(revisionCalls(await cliRun(baseSha), baseSha)).toEqual({ base: 1, head: 1, mergeBase: 1 });
  });

  it("the Action: rev-parse once for the base and once for HEAD, merge-base once", async () => {
    expect(revisionCalls(await actionRun(baseSha), baseSha)).toEqual({ base: 1, head: 1, mergeBase: 1 });
  });

  it("a base that is HEAD: the base-is-HEAD check resolves the revisions once too", async () => {
    // The diff is empty, so the check asks for the merge base, finds HEAD and reports DIFF_UNAVAILABLE.
    expect(revisionCalls(await cliRun(headSha), headSha)).toEqual({ base: 1, head: 1, mergeBase: 1 });
  });
});
