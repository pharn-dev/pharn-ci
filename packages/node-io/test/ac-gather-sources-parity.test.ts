import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CheckInput, PythonIndexRun } from "../../core/src/index.js";
import { noNetwork } from "./required-deps.js";

// CORE-136: the CLI and the Action gather the optional `CheckInput` fields with one function (`gatherSources` in
// node-io). This table runs both entry points, with real git, on the same temporary repository and the same settings,
// and asserts that check() receives the same gathered fields from each. check() is wrapped to record its input; it runs
// as it always does.

const captured = vi.hoisted(() => ({ inputs: [] as unknown[] }));
vi.mock("@pharn-ci/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../core/src/index.js")>();
  return {
    ...actual,
    check: (input: CheckInput) => {
      captured.inputs.push(input);
      return actual.check(input);
    },
  };
});

/** The optional `CheckInput` fields gatherSources decides. */
const GATHERED = [
  "repoFileBytes",
  "testSources",
  "pythonTestIndex",
  "agentConfigSources",
  "agentInstructionSources",
  "policySettingsSources",
  "selfModificationSources",
  "staleInstructionSources",
  "dependencySources",
] as const;

const NO_PYTHON = "pharn-ci: no Python interpreter was found (python-not-found), so TI02 and TI05 did not run";

let dir: string;
let baseSha: string;
let headSha: string;

function put(path: string, text: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-gather-parity-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  put("src/math.ts", "export const add = (a: number, b: number) => a + b;\n");
  put(
    "src/math.test.ts",
    'import { add } from "./math";\ntest("add", () => {\n  expect(add(1, 2)).toBe(3);\n  expect(add(2, 2)).toBe(4);\n});\n',
  );
  put("tests/test_math.py", "def test_add():\n    assert 1 + 2 == 3\n    assert 2 + 2 == 4\n");
  put("package.json", `${JSON.stringify({ name: "demo", dependencies: { "left-pad": "1.3.0" } }, null, 2)}\n`);
  put(".mcp.json", `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
  put("AGENTS.md", "# Agents\n\nRun `npm test`. The code is in `src/math.ts`.\n");
  put("CLAUDE.md", "# Claude\n\nRun `npm test`. The code is in `src/math.ts`.\n");
  put(".claude/settings.json", `${JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }, null, 2)}\n`);
  put("policy/org.json", `${JSON.stringify({ version: 1, setup: { forbidden_permissions: ["Bash(curl:*)"] } })}\n`);
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  baseSha = sh("rev-parse", "HEAD");
  put(
    "src/math.ts",
    "export const add = (a: number, b: number) => a + b;\nexport const sub = (a: number, b: number) => a - b;\n",
  );
  put("src/math.test.ts", 'import { add } from "./math";\ntest("add", () => {\n  expect(add(1, 2)).toBe(3);\n});\n');
  put("tests/test_math.py", "def test_add():\n    assert 1 + 2 == 3\n");
  put(
    "package.json",
    `${JSON.stringify({ name: "demo", dependencies: { "left-pad": "1.3.0", "is-odd": "3.0.1" } }, null, 2)}\n`,
  );
  put(".mcp.json", `${JSON.stringify({ mcpServers: { local: { command: "node" } } }, null, 2)}\n`);
  put(
    ".claude/settings.json",
    `${JSON.stringify({ permissions: { allow: ["Bash(ls)", "Bash(curl:*)"] } }, null, 2)}\n`,
  );
  sh("add", "-A");
  sh("commit", "-q", "-m", "head");
  headSha = sh("rev-parse", "HEAD");
  // Not committed: the coverage report the test step wrote.
  put("coverage/lcov.info", "SF:src/math.ts\nDA:1,1\nDA:2,1\nend_of_record\n");
}, 60_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The same Python answer for both: no interpreter, so the log line of drift (b) shows up in each channel. */
const noPython = async (): Promise<PythonIndexRun> => ({
  available: false,
  reason: "python-not-found",
  detail: "python3 was not found",
});

interface Settings {
  base: () => string;
  policy: boolean;
  testIntegrity: "warn" | "off";
  dependencies: "auto" | "never";
}

function lastInput(): Record<string, unknown> {
  const input = captured.inputs.at(-1);
  expect(input, "check() was called").toBeDefined();
  captured.inputs.length = 0;
  return input as Record<string, unknown>;
}

function gathered(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(GATHERED.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}

async function cliRun(settings: Settings) {
  const { main } = await import("../../cli/src/main.js");
  const { nodeDeps } = await import("../../cli/src/nodeDeps.js");
  let stderr = "";
  const deps = {
    ...nodeDeps(dir),
    indexPython: noPython,
    stdout: () => {},
    stderr: (text: string) => (stderr += text),
  };
  const args = [
    "check",
    "--base",
    settings.base(),
    "--coverage",
    "coverage/lcov.info",
    "--format",
    "json",
    "--test-integrity",
    settings.testIntegrity,
    "--dependencies",
    settings.dependencies,
    ...(settings.policy ? ["--policy-file", "policy/org.json"] : ["--no-policy"]),
  ];
  const code = await main(args, deps);
  expect(code, stderr).not.toBe(2);
  return { input: lastInput(), log: stderr.split("\n") };
}

async function actionRun(settings: Settings) {
  const { run } = await import("../../action/src/run.js");
  const io = await import("../src/index.js");
  const inputs: Record<string, string> = {
    "coverage-file": "coverage/lcov.info",
    "base-ref": settings.base(),
    "test-integrity": settings.testIntegrity,
    dependencies: settings.dependencies,
    policy: settings.policy ? "file:policy/org.json" : "never",
    upload: "never",
    comment: "false",
    "fail-on-verdict": "false",
  };
  const infos: string[] = [];
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
    git: (args) => io.runGit(dir, args),
    gitStream: (args) => io.streamGit(dir, args),
    gitBatch: (args, input) => io.runGitBatch(dir, args, input),
    indexPython: noPython,
    readFile: (path) => io.readFile(path),
    readFileStream: (path) => io.readFileStream(path),
    listDir: (path) => io.listDir(path),
    lstat: (path) => io.lstatPath(path),
    fetch: noNetwork,
    writeFile: async () => {},
    resolvePath: (...segments) => resolve(...segments),
    info: (message) => infos.push(message),
    warning: (message) => infos.push(message),
    setOutput: () => {},
    setFailed: (message) => failed.push(message),
    writeSummary: async () => {},
  });
  expect(failed).toEqual([]);
  return { input: lastInput(), log: infos };
}

const ROWS: { name: string; settings: Settings; expectKeys: readonly (typeof GATHERED)[number][] }[] = [
  {
    name: "a local diff under a file policy, test integrity warn, dependencies auto",
    settings: { base: () => baseSha, policy: true, testIntegrity: "warn", dependencies: "auto" },
    expectKeys: GATHERED,
  },
  {
    // Drift (a): the diff is unavailable (the base is HEAD), yet HEAD is the head under review, so both read its
    // committed agent config, instruction and settings files. Before CORE-136 the Action left them unscanned.
    name: "a base that is HEAD: no diff, the files at HEAD still read",
    settings: { base: () => headSha, policy: true, testIntegrity: "warn", dependencies: "auto" },
    expectKeys: [
      "repoFileBytes",
      "testSources",
      "agentConfigSources",
      "agentInstructionSources",
      "policySettingsSources",
      "selfModificationSources",
      "dependencySources",
    ],
  },
  {
    name: "test integrity off, dependencies never, no policy",
    settings: { base: () => baseSha, policy: false, testIntegrity: "off", dependencies: "never" },
    expectKeys: ["repoFileBytes", "agentConfigSources", "staleInstructionSources"],
  },
];

describe("CORE-136: the CLI and the Action gather the same optional CheckInput fields", { timeout: 120_000 }, () => {
  for (const row of ROWS) {
    it(row.name, async () => {
      const cli = await cliRun(row.settings);
      const action = await actionRun(row.settings);
      expect(Object.keys(gathered(cli.input)).sort()).toEqual([...row.expectKeys].sort());
      expect(gathered(action.input)).toEqual(gathered(cli.input));
    });
  }

  it("drift (a): with no diff the agent config files are scanned at HEAD by both, never marked unscanned", async () => {
    const settings: Settings = { base: () => headSha, policy: false, testIntegrity: "warn", dependencies: "auto" };
    for (const { input } of [await cliRun(settings), await actionRun(settings)]) {
      expect(input.diff).toHaveProperty("unavailable");
      expect(input.agentConfigSources).toHaveProperty("files");
      expect(input.agentConfigSources).not.toHaveProperty("unavailable");
    }
  });

  it("drift (b): a missing Python interpreter is logged by both, each in its own log channel", async () => {
    const settings: Settings = { base: () => baseSha, policy: false, testIntegrity: "warn", dependencies: "auto" };
    const cli = await cliRun(settings);
    const action = await actionRun(settings);
    expect(cli.input.pythonTestIndex).toEqual({ available: false, reason: "python-not-found" });
    expect(cli.log).toContain(NO_PYTHON);
    expect(action.log).toContain(NO_PYTHON);
  });
});
