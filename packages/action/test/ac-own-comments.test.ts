import { readFileSync } from "node:fs";
import type { AgentPrFacts } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import { commentScopeLine, type IssueComment, ownComments, prWriterLogins, run } from "../src/run.js";

// CORE-120: with an unknown viewer (the default GITHUB_TOKEN or an App token), pharn-ci does not adopt a marker comment
// written by a bot that wrote the pull request (its author, or the author or committer of one of its commits), except
// `github-actions[bot]`, the login pharn-ci itself comments as on the default token. A known viewer is unchanged.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (p: string) => readFileSync(new URL(p, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const MARKER = "<!-- pharn-ci -->";
const SCOPE = commentScopeLine("CI", "pharn");
const TOKEN_BOT = "github-actions[bot]";
const AGENT_BOT = "coding-agent[bot]";
const COMMIT_BOT = "pusher-agent[bot]";
const OTHER_BOT = "pharn-app[bot]";
const PERSON = "octocat";
const KNOWN_VIEWER = "release-bot";

const scoped = (id: number, login: string): IssueComment => ({
  id,
  body: `${MARKER}\n${SCOPE}\n## pharn-ci: pass (an earlier run)`,
  user: { login },
});
const legacy = (id: number, login: string): IssueComment => ({
  id,
  body: `${MARKER}\n## pharn-ci: pass (an earlier version)`,
  user: { login },
});

/** Facts of a pull request by `author` whose commits are listed in full. */
const facts = (
  author: string,
  type: "User" | "Bot",
  commits: { authorLogin: string | null; committerLogin: string | null }[],
): AgentPrFacts => ({
  pr: { author: { login: author, type }, labels: [], commits: commits.map((c) => ({ ...c, message: "change" })) },
});

/** A pull request opened by AGENT_BOT, with one commit authored by COMMIT_BOT and committed through the web. */
const AGENT_PR = facts(AGENT_BOT, "Bot", [{ authorLogin: COMMIT_BOT, committerLogin: "web-flow" }]);

describe("CORE-120: prWriterLogins", () => {
  it("collects the author and every commit's author and committer, lower-cased", () => {
    const writers = prWriterLogins(
      facts("Coding-Agent[bot]", "Bot", [
        { authorLogin: "Pusher-Agent[bot]", committerLogin: null },
        { authorLogin: null, committerLogin: "Committer-Bot[bot]" },
      ]),
    );
    expect(writers === null ? null : [...writers].sort()).toEqual([
      "coding-agent[bot]",
      "committer-bot[bot]",
      "pusher-agent[bot]",
    ]);
  });

  it.each<[string, AgentPrFacts]>([
    ["no pull request", { pr: null }],
    ["an unreadable author", { pr: { author: null, labels: [], commits: [] } }],
    ["unreadable commits", { pr: { author: { login: PERSON, type: "User" }, labels: [], commits: null } }],
    [
      "commits cut short",
      { pr: { author: { login: PERSON, type: "User" }, labels: [], commits: [], commitsIncomplete: true } },
    ],
  ])("is null for %s", (_name, input) => {
    expect(prWriterLogins(input)).toBeNull();
  });
});

describe("CORE-120: ownComments, viewer x comment author", () => {
  const writers = prWriterLogins(AGENT_PR);
  // [viewer, comment author, adopted]
  const table: [string, string | null, string, boolean][] = [
    ["unknown", null, AGENT_BOT, false],
    ["unknown", null, COMMIT_BOT, false],
    ["unknown", null, TOKEN_BOT, true],
    ["unknown", null, OTHER_BOT, true],
    ["unknown", null, PERSON, false],
    ["known", KNOWN_VIEWER, AGENT_BOT, false],
    ["known", KNOWN_VIEWER, COMMIT_BOT, false],
    ["known", KNOWN_VIEWER, TOKEN_BOT, false],
    ["known", KNOWN_VIEWER, OTHER_BOT, false],
    ["known", KNOWN_VIEWER, PERSON, false],
    ["known", KNOWN_VIEWER, KNOWN_VIEWER, true],
    // A known viewer that is itself a writer of the pull request still adopts its own comment: unchanged.
    ["known", AGENT_BOT, AGENT_BOT, true],
  ];

  it.each(table)("viewer %s (%s), comment by %s: adopted %s", (_kind, viewer, author, adopted) => {
    const found = ownComments([scoped(10, author)], viewer, SCOPE, writers);
    expect(found.map((c) => c.id)).toEqual(adopted ? [10] : []);
  });

  it("compares the writers case-insensitively", () => {
    expect(ownComments([scoped(10, "Coding-Agent[bot]")], null, SCOPE, writers)).toEqual([]);
  });

  it("with an unknown viewer and writers not all known, adopts only github-actions[bot]", () => {
    const comments = [scoped(10, OTHER_BOT), scoped(11, TOKEN_BOT), legacy(12, TOKEN_BOT), scoped(13, PERSON)];
    expect(ownComments(comments, null, SCOPE, null).map((c) => c.id)).toEqual([11, 12]);
  });

  it("on a pull request opened by github-actions[bot], still adopts github-actions[bot] comments", () => {
    const workflowPr = prWriterLogins(facts(TOKEN_BOT, "Bot", [{ authorLogin: TOKEN_BOT, committerLogin: TOKEN_BOT }]));
    const comments = [scoped(10, TOKEN_BOT), legacy(9, TOKEN_BOT)];
    expect(ownComments(comments, null, SCOPE, workflowPr).map((c) => c.id)).toEqual([9, 10]);
  });

  it("with an unknown viewer, a legacy comment of another bot is still never adopted", () => {
    expect(ownComments([legacy(10, OTHER_BOT)], null, SCOPE, writers)).toEqual([]);
  });
});

interface Calls {
  created: string[];
  updated: number[];
  deleted: number[];
}

interface RunOptions {
  viewer: string | null;
  /** The login createComment answers with (default: the viewer, else github-actions[bot]). */
  createdLogin?: string;
  author: { login: string; type: string };
  commits: { author: { login: string } | null; committer: { login: string } | null }[];
}

/** One pull_request run of the action with comments on, against `store` (changed in place). */
async function runOnce(store: IssueComment[], opts: RunOptions): Promise<Calls> {
  const createdLogin = opts.createdLogin ?? opts.viewer ?? TOKEN_BOT;
  const calls: Calls = { created: [], updated: [], deleted: [] };
  let nextId = 1000 + store.length;
  const inputs: Record<string, string> = { "coverage-file": "coverage/lcov.info", comment: "true", config: "" };
  const files: Record<string, string> = { [`${WORKSPACE}/coverage/lcov.info`]: fixture("golden/coverage.info") };
  const deps = {
    getInput: (name: string) => inputs[name] ?? "",
    context: {
      eventName: "pull_request",
      sha: "merge000",
      ref: "refs/pull/7/merge",
      workflow: "CI",
      job: "pharn",
      repo: { owner: "octo", repo: "demo" },
      issue: { owner: "octo", repo: "demo", number: 7 },
      payload: {
        pull_request: {
          number: 7,
          user: opts.author,
          commits: opts.commits.length,
          base: { sha: "a".repeat(40) },
          head: { sha: "b".repeat(40) },
        },
      },
    },
    workspace: WORKSPACE,
    tempDir: "/tmp/runner",
    api: {
      compareDiff: async () => fixture("golden/pr.diff"),
      listPullRequestCommits: async () => ({
        commits: opts.commits.map((c) => ({ ...c, commit: { message: "change" } })),
        hasNext: false,
      }),
      viewerLogin: async () => opts.viewer,
      listComments: async () => store.map((c) => ({ ...c, user: c.user ? { ...c.user } : c.user })),
      createComment: async (_n: number, body: string) => {
        calls.created.push(body);
        store.push({ id: nextId++, body, user: { login: createdLogin } });
        return createdLogin;
      },
      updateComment: async (id: number, body: string) => {
        calls.updated.push(id);
        const c = store.find((x) => x.id === id);
        if (c) c.body = body;
      },
      deleteComment: async (id: number) => {
        calls.deleted.push(id);
        const i = store.findIndex((x) => x.id === id);
        if (i >= 0) store.splice(i, 1);
      },
    },
    async git(args: string[]) {
      if (args[0] === "ls-files") return `${fixture("golden/files.txt").trim().split("\n").join("\0")}\0`;
      if (args[0] === "ls-tree") return "";
      if (args[0] === "rev-parse" && args[1] === "HEAD") return `${"c".repeat(40)}\n`;
      if (args[0] === "rev-parse") return "ok\n";
      if (args[0] === "diff") return fixture("golden/pr.diff");
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
    readFile: async (p: string) => files[p] ?? null,
    writeFile: async () => {},
    resolvePath: (...segments: string[]) =>
      segments.reduce((acc, s) => (s.startsWith("/") ? s : `${acc.replace(/\/$/, "")}/${s.replace(/^\.\//, "")}`), ""),
    info: () => {},
    warning: () => {},
    setOutput: () => {},
    setFailed: () => {},
    writeSummary: async () => {},
  };
  await run(deps as never);
  return calls;
}

const AGENT_AUTHOR = { login: AGENT_BOT, type: "Bot" };
const HUMAN_AUTHOR = { login: PERSON, type: "User" };
const AGENT_COMMITS = [{ author: { login: COMMIT_BOT }, committer: { login: "web-flow" } }];
const thisRun = (body: string | undefined) => (body ?? "").startsWith(`${MARKER}\n${SCOPE}\n`);

describe("CORE-120: the action does not adopt the agent's comment", () => {
  it("unknown viewer: a marker comment by the PR author's bot is not adopted; pharn-ci posts its own", async () => {
    const agentComment = scoped(5, AGENT_BOT);
    const store = [{ ...agentComment }];
    const calls = await runOnce(store, { viewer: null, author: AGENT_AUTHOR, commits: AGENT_COMMITS });
    expect(calls.created).toHaveLength(1);
    expect(thisRun(calls.created[0])).toBe(true);
    expect(calls.updated).not.toContain(5);
    expect(calls.deleted).not.toContain(5);
    expect(store.find((c) => c.id === 5)?.body).toBe(agentComment.body);
  });

  it("unknown viewer: a marker comment by a bot that authored a commit of the PR is not adopted", async () => {
    const pusherComment = scoped(5, COMMIT_BOT);
    const store = [{ ...pusherComment }];
    const calls = await runOnce(store, { viewer: null, author: HUMAN_AUTHOR, commits: AGENT_COMMITS });
    expect(calls.created).toHaveLength(1);
    expect(calls.updated).not.toContain(5);
    expect(calls.deleted).not.toContain(5);
    expect(store.find((c) => c.id === 5)?.body).toBe(pusherComment.body);
  });

  it("unknown viewer: a marker comment by github-actions[bot] on a PR by a human is adopted, as before", async () => {
    const store = [scoped(5, TOKEN_BOT)];
    const calls = await runOnce(store, {
      viewer: null,
      author: HUMAN_AUTHOR,
      commits: [{ author: { login: PERSON }, committer: { login: PERSON } }],
    });
    expect(calls.created).toEqual([]);
    expect(calls.updated).toEqual([5]);
    expect(thisRun(store[0]?.body)).toBe(true);
  });

  it("a PR opened by github-actions[bot]: the second run updates the first run's comment and posts no new one", async () => {
    const opts: RunOptions = {
      viewer: null,
      author: { login: TOKEN_BOT, type: "Bot" },
      commits: [{ author: { login: TOKEN_BOT }, committer: { login: TOKEN_BOT } }],
    };
    const store: IssueComment[] = [];
    const first = await runOnce(store, opts);
    expect(first.created).toHaveLength(1);
    const ids = store.map((c) => c.id);
    for (let i = 0; i < 2; i++) {
      const again = await runOnce(store, opts);
      expect(again.created).toEqual([]);
      expect(again.updated).toEqual(ids);
      expect(again.deleted).toEqual([]);
    }
    expect(store).toHaveLength(1);
  });

  it("known viewer: unchanged, it updates its own comment even when its login wrote the PR", async () => {
    const store = [scoped(4, AGENT_BOT), scoped(5, KNOWN_VIEWER)];
    const calls = await runOnce(store, { viewer: KNOWN_VIEWER, author: AGENT_AUTHOR, commits: AGENT_COMMITS });
    expect(calls.created).toEqual([]);
    expect(calls.updated).toEqual([5]);
    expect(calls.deleted).toEqual([]);

    const own = [scoped(6, AGENT_BOT)];
    const asAgent = await runOnce(own, { viewer: AGENT_BOT, author: AGENT_AUTHOR, commits: AGENT_COMMITS });
    expect(asAgent.created).toEqual([]);
    expect(asAgent.updated).toEqual([6]);
  });

  it("never edits or deletes the agent's comment, also when the created comment has the agent's login", async () => {
    // An App token that is also the PR author's bot: the created comment's login is a writer of the pull request, so
    // the clean-up after the create does not keep and rewrite the older comment of that login.
    const agentComment = scoped(5, AGENT_BOT);
    const store = [{ ...agentComment }, scoped(6, OTHER_BOT)];
    const calls = await runOnce(store, {
      viewer: null,
      createdLogin: AGENT_BOT,
      author: AGENT_AUTHOR,
      commits: AGENT_COMMITS,
    });
    // OTHER_BOT did not write the pull request, so its comment is adopted and nothing is created.
    expect(calls.updated).toEqual([6]);
    expect(store.find((c) => c.id === 5)?.body).toBe(agentComment.body);

    const onlyAgent = [{ ...agentComment }];
    const second = await runOnce(onlyAgent, {
      viewer: null,
      createdLogin: AGENT_BOT,
      author: AGENT_AUTHOR,
      commits: AGENT_COMMITS,
    });
    expect(second.created).toHaveLength(1);
    expect(second.updated).toEqual([]);
    expect(second.deleted).toEqual([]);
    expect(onlyAgent.find((c) => c.id === 5)?.body).toBe(agentComment.body);
  });

  it("unknown viewer, commits that cannot be read: another bot's comment is not adopted, github-actions[bot]'s is", async () => {
    const opts = { viewer: null, author: HUMAN_AUTHOR, commits: AGENT_COMMITS };
    const store = [scoped(5, OTHER_BOT)];
    // An unreadable commit list (a page that is not a list) leaves the writers unknown.
    const calls = await runOnceWithBrokenCommits(store, opts);
    expect(calls.created).toHaveLength(1);
    expect(calls.updated).not.toContain(5);
    expect(calls.deleted).not.toContain(5);

    const tokenStore = [scoped(5, TOKEN_BOT)];
    const token = await runOnceWithBrokenCommits(tokenStore, opts);
    expect(token.created).toEqual([]);
    expect(token.updated).toEqual([5]);
  });
});

/** runOnce with a commit listing whose page is not a list, so the pull request's commits count as unreadable. */
async function runOnceWithBrokenCommits(store: IssueComment[], opts: RunOptions): Promise<Calls> {
  return runOnce(store, { ...opts, commits: "not a list" as never });
}
