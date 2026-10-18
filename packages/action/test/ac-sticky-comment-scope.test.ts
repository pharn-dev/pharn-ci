import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// run() is imported inside each test body, like the other AC tests written before the build.
// A pull_request run on fixtures/golden/ with comments on, a context naming workflow "CI" and job "pharn", and an
// in-memory comment store: listComments returns it, createComment appends to it and resolves the created comment's
// author login, updateComment and deleteComment change it. Every call is recorded.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (p: string) => readFileSync(new URL(p, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const MARKER = "<!-- pharn-ci -->";
const SCOPE = "<!-- pharn-ci scope: CI/pharn -->";
const OTHER_SCOPE = "<!-- pharn-ci scope: CI/lint -->";
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
  warnings: string[];
}

const scoped = (id: number, login: string, scope = SCOPE): StoredComment => ({
  id,
  body: `${MARKER}\n${scope}\n## ✅ pharn-ci: pass (an earlier run)`,
  user: { login },
});

function newStore(comments: StoredComment[] = []): Store {
  return { comments: comments.map((c) => ({ ...c, user: { ...c.user } })), nextId: 1000 };
}

/** Runs the action once against `store`, with the given viewer login and the login createComment reports. */
async function runOnce(store: Store, viewer: string | null, createdLogin: string | null): Promise<Calls> {
  const { run } = await import("../src/run.js");
  const calls: Calls = { created: [], updated: [], deleted: [], warnings: [] };
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
      viewerLogin: async () => viewer,
      listComments: async () => store.comments.map((c) => ({ ...c, user: { ...c.user } })),
      createComment: async (_issueNumber: number, body: string) => {
        calls.created.push(body);
        store.comments.push({ id: store.nextId++, body, user: { login: createdLogin ?? "unknown" } });
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
    warning: (m: string) => {
      calls.warnings.push(m);
    },
    setOutput: () => {},
    setFailed: () => {},
    writeSummary: async () => {},
  };
  await run(deps as never);
  return calls;
}

describe("action: sticky comment scoped to the workflow and job", () => {
  it("AC-1: posts the marker line followed by the CI/pharn scope line", async () => {
    const calls = await runOnce(newStore(), null, APP_LOGIN);
    expect(calls.created).toHaveLength(1);
    const lines = (calls.created[0] ?? "").split("\n");
    expect(lines[0]).toBe(MARKER);
    expect(lines[1]).toBe(SCOPE);
  });

  it("AC-1: with an unknown viewer, updates a bot-authored comment carrying this run's scope and creates none", async () => {
    const store = newStore([{ id: 1, body: "unrelated", user: { login: "octocat" } }, scoped(41, APP_LOGIN)]);
    const calls = await runOnce(store, null, APP_LOGIN);
    expect(calls.created).toEqual([]);
    expect(calls.updated.map((u) => u.id)).toEqual([41]);
    expect((calls.updated[0]?.body ?? "").startsWith(`${MARKER}\n${SCOPE}\n`)).toBe(true);
    expect(calls.deleted).toEqual([]);
  });

  it("AC-1: never updates or deletes a comment carrying another scope line, and creates a new scoped one", async () => {
    const store = newStore([scoped(51, "github-actions[bot]", OTHER_SCOPE), scoped(52, APP_LOGIN, OTHER_SCOPE)]);
    const calls = await runOnce(store, null, APP_LOGIN);
    expect(calls.updated.map((u) => u.id)).not.toContain(51);
    expect(calls.updated.map((u) => u.id)).not.toContain(52);
    expect(calls.deleted).not.toContain(51);
    expect(calls.deleted).not.toContain(52);
    expect(calls.created).toHaveLength(1);
    expect((calls.created[0] ?? "").startsWith(`${MARKER}\n${SCOPE}\n`)).toBe(true);
    expect(store.comments.find((c) => c.id === 51)?.body).toBe(scoped(51, "github-actions[bot]", OTHER_SCOPE).body);
    expect(store.comments.find((c) => c.id === 52)?.body).toBe(scoped(52, APP_LOGIN, OTHER_SCOPE).body);
  });

  it("AC-1: an App token's second run updates the comment its first run created instead of creating another", async () => {
    const store = newStore();
    const first = await runOnce(store, null, APP_LOGIN);
    expect(first.created).toHaveLength(1);
    const createdIds = store.comments.map((c) => c.id);
    expect(createdIds).toHaveLength(1);

    const second = await runOnce(store, null, APP_LOGIN);
    expect(second.created).toEqual([]);
    expect(second.updated.map((u) => u.id)).toEqual(createdIds);
    expect(second.deleted).toEqual([]);
    expect(store.comments).toHaveLength(1);
  });
});
