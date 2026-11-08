import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// Org-policy rule P13 in the Action. check() is observed, not replaced: the mock calls the real check() and records the
// input the Action built. The workspace is a real git repository: the base commit holds the agent settings, MCP config,
// workflow and CODEOWNERS of fixtures/policy-rules/p13/, the head commit widens the settings and the workflow, and the
// Action reads both sides with the Node git runners.
vi.mock("@pharn-ci/core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, check: vi.fn(actual.check as (input: unknown) => unknown) };
});

const ROOT = new URL("../../../", import.meta.url);
const p13 = (name: string) => readFileSync(new URL(`fixtures/policy-rules/p13/${name}`, ROOT), "utf8");
const POLICY_PATH = ".pharn/policy.json";

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Report = { verdict: string; messages: { code: string; level: string }[]; policy?: { violations: Violation[] } };
type Side = { unavailable?: string; files?: { path: string; text: string }[]; dropped?: unknown[] };
type Input = Record<string, unknown> & { selfModificationSources?: { base: Side; head: Side } };

let dir: string;
let mainId: string;
let headId: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-p13-action-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const put = (path: string, text: string) => {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  put("AGENTS.md", "# Agents\n");
  put(POLICY_PATH, JSON.stringify({ version: 1 }));
  put(".claude/settings.json", p13("settings/base.json.txt"));
  put(".mcp.json", p13("mcp/base.json.txt"));
  put(".github/workflows/ci.yml", p13("workflow/base.yml.txt"));
  put(".github/CODEOWNERS", p13("codeowners/base.txt"));
  put("src/math.ts", "export const a = 1;\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  mainId = sh("rev-parse", "HEAD").trim();
  sh("checkout", "-q", "-b", "feature");
  put(".claude/settings.json", p13("settings/allow-grew.json.txt"));
  put(".github/workflows/ci.yml", p13("workflow/secret-added.yml.txt"));
  put(".github/CODEOWNERS", p13("codeowners/owners-appended.txt"));
  put("src/math.ts", "export const a = 2;\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  headId = sh("rev-parse", "HEAD").trim();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function realReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

async function actionRun(author: { login: string; type: string }, inputs: Record<string, string>) {
  const { run } = await import("../src/run.js");
  const { createNodeIo } = await import("../src/node-io.js");
  const core = await import("@pharn-ci/core");
  const spy = vi.mocked(core.check);
  const lcov = `SF:${dir}/src/math.ts\nDA:1,1\nend_of_record\n`;
  const h = harness({
    inputs,
    files: { [`${dir}/coverage/lcov.info`]: lcov },
    context: {
      ...PR_CONTEXT,
      payload: {
        pull_request: { number: 7, base: { sha: mainId }, head: { sha: headId }, user: author, labels: [], commits: 1 },
      },
    },
  });
  const io = createNodeIo(dir) as unknown as Record<string, unknown>;
  const deps = h.deps as unknown as Record<string, unknown>;
  Object.assign(deps, {
    workspace: dir,
    readFile: realReadFile,
    git: io.git,
    gitStream: io.gitStream,
    gitBatch: io.gitBatch,
    listDir: io.listDir,
  });
  h.deps.api = {
    ...h.deps.api,
    async listPullRequestCommits(_pullNumber: number, page: number) {
      const commits = [{ commit: { message: "Widen\n" }, author: { login: author.login }, committer: null }];
      return { commits: page === 1 ? commits : [], hasNext: false };
    },
  } as typeof h.deps.api;
  spy.mockClear();
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error("no report was written");
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  const input = spy.mock.calls.at(-1)?.[0] as Input;
  return { report, input, text, failed: h.failed, comment: [...h.posted, ...h.summary, ...h.failed].join("\n") };
}

const p13Of = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P13");

describe("action: rule P13 reads the touched governance files at the merge base and at HEAD", () => {
  it("an agent PR under a file: policy gets one block finding per widened file, and no file text leaves the job", async () => {
    const agent = await actionRun({ login: "claude[bot]", type: "Bot" }, { policy: `file:${POLICY_PATH}` });
    const sources = agent.input.selfModificationSources;
    expect(sources?.base.files?.map((f) => f.path)).toEqual([
      ".claude/settings.json",
      ".github/CODEOWNERS",
      ".github/workflows/ci.yml",
    ]);
    expect(sources?.head.files?.find((f) => f.path === ".claude/settings.json")?.text).toBe(
      p13("settings/allow-grew.json.txt"),
    );
    expect(p13Of(agent.report).map((v) => [v.path, v.severity, v.detail])).toEqual([
      [".claude/settings.json", "block", "agent PR widens its agent settings: permissions.allow grew"],
      [".github/workflows/ci.yml", "block", "agent PR widens a workflow: secrets referenced grew"],
    ]);
    expect(agent.report.verdict).toBe("fail");
    expect(agent.text).not.toContain("SENTINEL");
    expect(agent.comment).not.toContain("SENTINEL");
  }, 60_000);

  it("the same change by a person gets no P13 finding; with no policy the sources are not gathered", async () => {
    const person = await actionRun({ login: "octocat", type: "User" }, { policy: `file:${POLICY_PATH}` });
    expect(p13Of(person.report)).toEqual([]);
    expect(person.failed).toEqual([]);
    const none = await actionRun({ login: "claude[bot]", type: "Bot" }, { policy: "never" });
    expect(Object.hasOwn(none.input, "selfModificationSources")).toBe(false);
    expect(none.report.policy).toBeUndefined();
  }, 60_000);
});
