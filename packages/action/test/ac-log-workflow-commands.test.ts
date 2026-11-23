import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getOctokit } from "@actions/github";
import { describe, expect, it } from "vitest";
import { requiredDeps } from "../../node-io/test/required-deps.js";
import { createGitHubApi } from "../src/api.js";
import { withRequestPolicy } from "../src/request-policy.js";
import { run } from "../src/run.js";

// CORE-39: a tracked directory whose name holds a newline puts its coverage report's path into the job log through
// coverage auto-discovery. The runner reads `core.info` text line by line and honours `::command::data` at the start
// of a line and `##[command]data` anywhere in one, so `::stop-commands::` would stop every later command, the
// `::add-mask::` of `core.setSecret` included. run() is driven with a recording `info`, as the runner would see it.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

type DirEntry = { name: string; kind: "file" | "directory" | "symlink" | "other" };

function fakeAction(files: Record<string, string>) {
  const info: string[] = [];
  const failed: string[] = [];
  const contents = new Map(Object.entries(files).map(([path, text]) => [resolve(WORKSPACE, path), text]));
  const children = new Map<string, Map<string, DirEntry["kind"]>>();
  for (const path of contents.keys()) {
    let child = path;
    let kind: DirEntry["kind"] = "file";
    while (child !== "/") {
      const parent = dirname(child);
      const entries = children.get(parent) ?? new Map<string, DirEntry["kind"]>();
      const name = child.slice(parent === "/" ? 1 : parent.length + 1);
      if (!entries.has(name)) entries.set(name, kind);
      children.set(parent, entries);
      child = parent;
      kind = "directory";
    }
  }
  const tracked = [...Object.keys(files), ...fixture("golden/files.txt").trim().split("\n")];
  const deps = {
    ...requiredDeps(() => deps),
    getInput: (name: string) => ({ comment: "false" })[name] ?? "",
    context: {
      eventName: "pull_request",
      sha: HEAD_SHA,
      ref: "refs/pull/7/merge",
      repo: { owner: "octo", repo: "demo" },
      issue: { owner: "octo", repo: "demo", number: 7 },
      payload: {
        pull_request: { number: 7, base: { sha: BASE_SHA, ref: "main" }, head: { sha: HEAD_SHA, ref: "feature" } },
      },
    },
    workspace: WORKSPACE,
    tempDir: "/home/runner/work/_temp",
    api: {
      compareDiff: async () => fixture("golden/pr.diff"),
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async () => {},
      updateComment: async () => {},
    },
    git: async (args: string[]) => {
      if (args.includes("ls-files")) return `${tracked.join("\0")}\0`;
      if (args.includes("--show-toplevel")) return `${WORKSPACE}\n`;
      if (args.includes("diff")) return fixture("golden/pr.diff");
      return `${BASE_SHA}\n`;
    },
    readFile: async (path: string) => contents.get(path) ?? null,
    listDir: async (path: string): Promise<DirEntry[] | null> => {
      const entries = children.get(path);
      return entries === undefined ? null : [...entries].map(([name, kind]) => ({ name, kind }));
    },
    writeFile: async () => {},
    resolvePath: (...segments: string[]) => resolve(...segments),
    info: (message: string) => {
      info.push(message);
    },
    warning: () => {},
    setOutput: () => {},
    setFailed: (message: string) => {
      failed.push(message);
    },
    writeSummary: async () => {},
  };
  return { deps, info, failed };
}

/** The lines the runner reads from what was logged: each `core.info` call ends a line, and \n, \r and \r\n end one. */
const runnerLines = (logged: readonly string[]) => logged.flatMap((message) => message.split(/\r\n|\r|\n/));

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

describe("action: a tracked path that holds a workflow command after a newline", () => {
  it.each(CASES)("logs no line that starts a command, with $spelling in the path", async ({ dir, shown }) => {
    const action = fakeAction({ [`${dir}/coverage.cobertura.xml`]: fixture("golden-cobertura/coverage.xml") });
    await run(action.deps as never);
    expect(action.failed).toEqual([]);
    const lines = runnerLines(action.info);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.trimStart().startsWith("::"), line).toBe(false);
      expect(line.trimStart().startsWith("##["), line).toBe(false);
      expect(line.includes("##["), line).toBe(false);
    }
    // The line still names the path, with each control character replaced by U+FFFD.
    expect(action.info).toContain(shown);
  });

  it("logs each message as one line: no message carries a newline or a carriage return", async () => {
    // Unescaped, the discovery line would put `::stop-commands::tok` on a line of its own.
    const action = fakeAction({
      "pkg\n::stop-commands::tok\n/coverage.cobertura.xml": fixture("golden-cobertura/coverage.xml"),
    });
    await run(action.deps as never);
    expect(action.info.some((message) => message.includes("\n") || message.includes("\r"))).toBe(false);
  });
});

describe("withRequestPolicy: the retry line it logs", () => {
  it("is escaped as one line when the error text holds a workflow command after a newline", async () => {
    // The real Octokit from @actions/github with only fetch mocked: a 502 whose message carries both spellings, then
    // a 201. The retry line names the error text, so it is untrusted text on its way to `core.info`.
    const logged: string[] = [];
    const answers = [
      { status: 502, body: JSON.stringify({ message: "Bad gateway\n::stop-commands::tok\r\n##[add-mask]x" }) },
      { status: 201, body: '{"id":1,"user":{"login":"me"}}' },
    ];
    const fetch = async () => {
      const answer = answers.shift();
      if (answer === undefined) throw new Error("no answer left");
      return new Response(answer.body, {
        status: answer.status,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    };
    const api = createGitHubApi({
      token: "t0ken",
      repo: () => ({ owner: "acme", repo: "demo" }),
      getOctokit: withRequestPolicy((token) => getOctokit(token, { request: { fetch } }), {
        sleep: async () => {},
        log: (message) => logged.push(message),
      }),
    });
    expect(await api.createComment(7, "body")).toBe("me");
    expect(logged).toHaveLength(1);
    const lines = runnerLines(logged);
    expect(lines).toHaveLength(1);
    for (const line of lines) {
      expect(line.trimStart().startsWith("::"), line).toBe(false);
      expect(line.includes("##["), line).toBe(false);
    }
    expect(logged[0]).toContain("Bad gateway�::stop-commands::tok��##\\[add-mask]x");
  });
});
