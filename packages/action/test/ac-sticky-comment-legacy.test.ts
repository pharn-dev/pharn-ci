import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// run() is imported inside each test body, like the other AC tests written before the build.
// A pull_request run on fixtures/golden/ with comments on, a context naming workflow "CI" and job "pharn", and an
// in-memory comment store: listComments returns it, createComment appends to it (then lets a test add the comments
// a concurrent run wrote) and resolves the created comment's author login, updateComment and deleteComment change it.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (p: string) => readFileSync(new URL(p, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const MARKER = "<!-- pharn-ci -->";
const SCOPE = "<!-- pharn-ci scope: CI/pharn -->";
const OTHER_SCOPE = "<!-- pharn-ci scope: CI/lint -->";
const TOKEN_BOT = "github-actions[bot]";
const APP_LOGIN = "pharn-app[bot]";

interface StoredComment {
  id: number;
  body: string;
  user: { login: string };
}

interface Store {
  comments: StoredComment[];
  nextId: number;
}

interface Calls {
  created: string[];
  updated: { id: number; body: string }[];
  deleted: number[];
}

const legacy = (id: number, login: string): StoredComment => ({
  id,
  body: `${MARKER}\n## ✅ pharn-ci: pass (an earlier version)`,
  user: { login },
});

const scoped = (id: number, login: string, scope = SCOPE): StoredComment => ({
  id,
  body: `${MARKER}\n${scope}\n## ✅ pharn-ci: pass (an earlier run)`,
  user: { login },
});

/** The (author login, scope line or "legacy") key of a stored comment, as listed before the run. */
const keyOf = (c: StoredComment): string => {
  const second = c.body.split("\n")[1] ?? "";
  return `${c.user.login} | ${second.startsWith("<!-- pharn-ci scope:") ? second : "legacy"}`;
};

function newStore(comments: StoredComment[]): Store {
  return { comments: comments.map((c) => ({ ...c, user: { ...c.user } })), nextId: 1000 };
}

interface RunOptions {
  viewer: string | null;
  createdLogin?: string | null;
  /** Called after createComment stored the new comment: a concurrent run's comments appear here. */
  afterCreate?: (store: Store) => void;
}

async function runOnce(store: Store, opts: RunOptions): Promise<Calls> {
  const { run } = await import("../src/run.js");
  const createdLogin = opts.createdLogin === undefined ? opts.viewer : opts.createdLogin;
  const calls: Calls = { created: [], updated: [], deleted: [] };
  const inputs: Record<string, string> = {
    "coverage-file": "coverage/lcov.info",
    comment: "true",
    "fail-on-threshold": "true",
    config: "",
  };
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
      payload: { pull_request: { number: 7, base: { sha: "a".repeat(40) }, head: { sha: "b".repeat(40) } } },
    },
    workspace: WORKSPACE,
    tempDir: "/tmp/runner",
    api: {
      compareDiff: async () => fixture("golden/pr.diff"),
      viewerLogin: async () => opts.viewer,
      listComments: async () => store.comments.map((c) => ({ ...c, user: { ...c.user } })),
      createComment: async (_issueNumber: number, body: string) => {
        calls.created.push(body);
        store.comments.push({ id: store.nextId++, body, user: { login: createdLogin ?? "unknown" } });
        opts.afterCreate?.(store);
        return createdLogin;
      },
      updateComment: async (id: number, body: string) => {
        calls.updated.push({ id, body });
        const comment = store.comments.find((c) => c.id === id);
        if (comment) comment.body = body;
      },
      deleteComment: async (id: number) => {
        calls.deleted.push(id);
        store.comments = store.comments.filter((c) => c.id !== id);
      },
    },
    async git(args: string[]) {
      if (args[0] === "ls-files") return `${fixture("golden/files.txt").trim().split("\n").join("\0")}\0`;
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

const updatedWithThisRunsBody = (calls: Calls) =>
  calls.updated.every((u) => u.body.startsWith(`${MARKER}\n${SCOPE}\n`));

describe("action: legacy sticky comments and duplicate deletion", () => {
  it("AC-2: with an unknown viewer, updates a legacy comment by github-actions[bot] and creates none", async () => {
    const calls = await runOnce(newStore([legacy(21, TOKEN_BOT)]), { viewer: null, createdLogin: APP_LOGIN });
    expect(calls.created).toEqual([]);
    expect(calls.updated.map((u) => u.id)).toEqual([21]);
    expect(updatedWithThisRunsBody(calls)).toBe(true);
    expect(calls.deleted).toEqual([]);
  });

  it("AC-2: with a known viewer, updates its own legacy or same-scope comment with this run's body and creates none", async () => {
    for (const comment of [legacy(31, "release-bot"), scoped(32, "release-bot")]) {
      const calls = await runOnce(newStore([legacy(30, TOKEN_BOT), comment]), { viewer: "release-bot" });
      expect(calls.created).toEqual([]);
      expect(calls.updated.map((u) => u.id)).toEqual([comment.id]);
      expect(updatedWithThisRunsBody(calls)).toBe(true);
      expect(calls.deleted).toEqual([]);
    }
  });

  it("AC-2: with an unknown viewer, leaves a legacy comment by another bot alone and creates a scoped one", async () => {
    const store = newStore([legacy(41, "dependabot[bot]")]);
    const calls = await runOnce(store, { viewer: null, createdLogin: APP_LOGIN });
    expect(calls.updated.map((u) => u.id)).not.toContain(41);
    expect(calls.deleted).not.toContain(41);
    expect(calls.created).toHaveLength(1);
    expect((calls.created[0] ?? "").startsWith(`${MARKER}\n${SCOPE}\n`)).toBe(true);
    expect(store.comments.find((c) => c.id === 41)?.body).toBe(legacy(41, "dependabot[bot]").body);
  });

  it("AC-2: after an update, deletes only comments with the kept comment's author login and scope", async () => {
    // Unknown viewer: own comments by two different bots with this scope, plus a legacy github-actions[bot] one.
    const unknownViewer = [
      scoped(10, APP_LOGIN),
      scoped(11, "other-app[bot]"),
      scoped(12, APP_LOGIN),
      legacy(13, TOKEN_BOT),
      scoped(14, APP_LOGIN, OTHER_SCOPE),
      legacy(15, APP_LOGIN),
    ];
    const listed = new Map(unknownViewer.map((c) => [c.id, keyOf(c)]));
    const calls = await runOnce(newStore(unknownViewer), { viewer: null, createdLogin: APP_LOGIN });
    expect(calls.created).toEqual([]);
    expect(calls.updated.map((u) => u.id)).toEqual([10]);
    expect(calls.deleted).toEqual([12]);
    for (const id of calls.deleted) expect(listed.get(id)).toBe(listed.get(10));

    // Known viewer: legacy duplicates of its own login are still removed; another login's are not.
    const knownViewer = [legacy(20, "release-bot"), legacy(21, "release-bot"), legacy(22, TOKEN_BOT)];
    const known = await runOnce(newStore(knownViewer), { viewer: "release-bot" });
    expect(known.created).toEqual([]);
    expect(known.updated.map((u) => u.id)).toEqual([20]);
    expect(updatedWithThisRunsBody(known)).toBe(true);
    expect(known.deleted).toEqual([21]);
  });

  it("AC-2: after a create, deletes only comments with the login create returned and this run's scope", async () => {
    // A concurrent run of the same job created comment 5 first; other comments must survive the clean-up.
    const racing = [
      scoped(5, APP_LOGIN),
      scoped(6, "other-app[bot]"),
      legacy(7, APP_LOGIN),
      scoped(8, APP_LOGIN, OTHER_SCOPE),
      legacy(9, "dependabot[bot]"),
    ];
    const store = newStore([legacy(9, "dependabot[bot]")]);
    const calls = await runOnce(store, {
      viewer: null,
      createdLogin: APP_LOGIN,
      afterCreate: (s) => {
        for (const c of racing.slice(0, 4)) s.comments.push({ ...c, user: { ...c.user } });
      },
    });
    expect(calls.created).toHaveLength(1);
    expect(calls.deleted).toEqual([1000]);
    for (const u of calls.updated) expect(u.id).toBe(5);
    expect(store.comments.map((c) => c.id).sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9]);
    expect(store.comments.find((c) => c.id === 5)?.body.startsWith(`${MARKER}\n${SCOPE}\n`)).toBe(true);
  });
});
