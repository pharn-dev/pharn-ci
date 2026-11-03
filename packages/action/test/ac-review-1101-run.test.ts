import { describe, expect, it, vi } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { createGitHubApi, type GitHubApiOptions } from "../src/api.js";
import { COMMIT_SHA } from "../src/pr-number.js";
import { type ActionContext, run } from "../src/run.js";
import { resolveBase, runMeta } from "../src/run-meta.js";
import { harness, PR_CONTEXT } from "./harness.js";

// The run.ts items of the 2026-11-01 review: 28 (an internal upload error names its class, and fails the step under
// debug logging), 45 (one base for the diff and for meta, and SHA-256 bases), 47 (API calls a run does not need) and
// 48 (the tree-truncation warning names P08).

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const SHA256 = "c".repeat(64);
const BEFORE = "d".repeat(40);
const TOKEN = ["oidc", "R1101", "a1b2"].join("-");

/** A run context with everything `meta` needs, so the report carries `meta` and the upload starts. */
const META_CONTEXT: ActionContext = {
  eventName: "pull_request",
  sha: "merge000",
  workflow: "ci",
  job: "check",
  runId: 9,
  runAttempt: 1,
  actor: "octocat",
  payload: {
    repository: { full_name: "acme/widgets", id: 42 },
    pull_request: { number: 7, base: { sha: BASE }, head: { sha: HEAD } },
  },
};

const PUSH_CONTEXT: ActionContext = {
  ...META_CONTEXT,
  eventName: "push",
  sha: HEAD,
  payload: { repository: { full_name: "acme/widgets", id: 42 }, before: BEFORE },
};

describe("review 45: one base for the diff and for meta", () => {
  it("resolveBase: the base-ref input first, recorded only when it is a commit SHA", () => {
    expect(resolveBase(PR_CONTEXT, {})).toEqual({ ref: BASE, sha: BASE });
    expect(resolveBase(PR_CONTEXT, { baseRef: "main" })).toEqual({ ref: "main", sha: null });
    expect(resolveBase(PR_CONTEXT, { baseRef: BEFORE.toUpperCase() })).toEqual({
      ref: BEFORE.toUpperCase(),
      sha: BEFORE,
    });
    expect(resolveBase(PR_CONTEXT, { baseRef: SHA256 })).toEqual({ ref: SHA256, sha: SHA256 });
    expect(resolveBase(PUSH_CONTEXT, {})).toEqual({ ref: BEFORE, sha: BEFORE });
    expect(resolveBase({ payload: { before: "0".repeat(40) } }, {})).toEqual({ ref: "", sha: null });
    const mergeGroup = { payload: { merge_group: { base_sha: BEFORE, head_sha: HEAD } } };
    expect(resolveBase(mergeGroup, {})).toEqual({ ref: BEFORE, sha: BEFORE });
    const target = { number: 42, baseSha: BEFORE, headSha: HEAD };
    expect(resolveBase(PR_CONTEXT, { target })).toEqual({ ref: BEFORE, sha: BEFORE });
    expect(resolveBase(PR_CONTEXT, { target, baseRef: "release" })).toEqual({ ref: "release", sha: null });
  });

  it("meta.baseSha is the base the diff was taken against, on pull_request and on push alike", () => {
    // Before: a pull_request run recorded the PR base whatever base-ref said, and a push run with a branch base-ref
    // recorded `before`, so meta named a commit the diff was not taken against.
    expect(runMeta(META_CONTEXT, {})?.baseSha).toBe(BASE);
    expect(runMeta(META_CONTEXT, { baseRef: "main" })?.baseSha).toBeNull();
    expect(runMeta(META_CONTEXT, { baseRef: BEFORE })?.baseSha).toBe(BEFORE);
    expect(runMeta(PUSH_CONTEXT, {})?.baseSha).toBe(BEFORE);
    expect(runMeta(PUSH_CONTEXT, { baseRef: "main" })?.baseSha).toBeNull();
    expect(runMeta(PUSH_CONTEXT, { baseRef: SHA256 })?.baseSha).toBe(SHA256);
  });

  it("the diff of a pull_request run uses base-ref when set, and report.json records no other base", async () => {
    const h = harness({ inputs: { "base-ref": "main", upload: "never" }, context: META_CONTEXT });
    const report = await run(h.deps);
    expect(h.failed).toEqual([]);
    expect(h.gitCalls).toContainEqual(["rev-parse", "--verify", "--quiet", "--end-of-options", "origin/main^{commit}"]);
    expect(h.gitCalls.flat().some((arg) => arg.includes(BASE))).toBe(false);
    expect(report?.meta?.baseSha).toBeNull();
    if (report !== undefined) expectValidReport(report);
  });

  it("a SHA-256 base-ref names one commit: it is not also tried as origin/<sha>", async () => {
    expect(COMMIT_SHA.test(SHA256)).toBe(true);
    expect(COMMIT_SHA.test(BASE)).toBe(true);
    expect(COMMIT_SHA.test("c".repeat(50))).toBe(false);
    const h = harness({ inputs: { "base-ref": SHA256, upload: "never" }, context: META_CONTEXT });
    const report = await run(h.deps);
    expect(h.failed).toEqual([]);
    const revParses = h.gitCalls.filter((args) => args[0] === "rev-parse" && args.at(-1)?.endsWith("^{commit}"));
    expect(revParses[0]).toEqual(["rev-parse", "--verify", "--quiet", "--end-of-options", `${SHA256}^{commit}`]);
    expect(h.gitCalls.flat().some((arg) => arg.includes(`origin/${SHA256}`))).toBe(false);
    expect(report?.meta?.baseSha).toBe(SHA256);
  });
});

describe("review 47: API calls a run does not need", () => {
  /** A fake app that answers every request with `status`. */
  function app(status: number) {
    const calls: string[] = [];
    return {
      calls,
      fetch: async (input: unknown, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${new URL(String(input)).pathname}`);
        return new Response(null, { status });
      },
    };
  }

  async function uploadingRun(status: number, options: { firstListFails?: boolean } = {}) {
    const h = harness({ inputs: { threshold: "50", policy: "never" }, context: META_CONTEXT });
    let viewerCalls = 0;
    let lists = 0;
    const listComments = h.deps.api.listComments;
    h.deps.api = {
      ...h.deps.api,
      listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
      viewerLogin: async () => {
        viewerCalls += 1;
        return "github-actions[bot]";
      },
      listComments: async (n: number) => {
        lists += 1;
        if (options.firstListFails === true && lists === 1) {
          h.apiCalls.push(`list ${n}`);
          throw new Error("secondary rate limit");
        }
        return listComments(n);
      },
    } as typeof h.deps.api;
    const fake = app(status);
    Object.assign(h.deps, {
      fetch: fake.fetch,
      getIDToken: async () => TOKEN,
      setSecret: () => {},
      hasOidcEnv: true,
      sleep: async () => {},
    });
    const report = await run(h.deps);
    return { h, report, fake, viewerCalls: () => viewerCalls };
  }

  it("the upload's comment link and the sticky comment share one listing (the app is not installed: 404)", async () => {
    const { h, report, fake, viewerCalls } = await uploadingRun(404);
    expect(fake.calls).toEqual(["POST /api/v1/runs/upload-url"]);
    expect(report?.meta?.upload).toEqual({ status: "skipped" });
    // One listing for the link lookup before the upload-url request, reused for the comment after the 404; the
    // second is the race clean-up after the create. Before, the comment listed them again: three in all.
    expect(h.apiCalls.filter((call) => call.startsWith("list "))).toEqual(["list 7", "list 7"]);
    expect(viewerCalls()).toBe(1);
    expect(h.apiCalls.filter((call) => call.startsWith("create "))).toEqual(["create 7"]);
  });

  it("the same after a failed upload", async () => {
    const { h, report, viewerCalls } = await uploadingRun(500);
    expect(report?.meta?.upload).toEqual({ status: "failed" });
    // As above: the relist after the create (the race clean-up) is the only other listing.
    expect(h.apiCalls.filter((call) => call.startsWith("list "))).toEqual(["list 7", "list 7"]);
    expect(viewerCalls()).toBe(1);
  });

  it("a listing that failed for the link is asked again for the comment", async () => {
    const { h } = await uploadingRun(404, { firstListFails: true });
    expect(h.infos).toContain(
      "pharn-ci: could not read the pull request comments, so the upload carries no comment link",
    );
    expect(h.apiCalls.filter((call) => call.startsWith("list ")).length).toBeGreaterThanOrEqual(2);
    expect(h.apiCalls).toContain("create 7");
    expect(h.warnings.join("\n")).not.toContain("could not post the PR comment");
  });

  it("reads the config and base-ref inputs once each", async () => {
    const h = harness({
      inputs: { config: ".pharn/ci.yml", upload: "never" },
      files: { "/home/runner/work/demo/demo/.pharn/ci.yml": "coverage:\n  threshold: 50\n" },
    });
    const reads: string[] = [];
    const getInput = h.deps.getInput;
    h.deps.getInput = (name) => {
      reads.push(name);
      return getInput(name);
    };
    await run(h.deps);
    expect(h.failed).toEqual([]);
    expect(reads.filter((name) => name === "config")).toEqual(["config"]);
    expect(reads.filter((name) => name === "base-ref")).toEqual(["base-ref"]);
  });

  it("createGitHubApi reads a pull request once for the target, the agent PR detection and the accept label", async () => {
    const pullsGet = vi.fn(async () => ({
      data: { base: { sha: BASE }, head: { sha: HEAD }, user: { login: "octocat" }, labels: [], commits: 1 },
    }));
    const octokit = { rest: { pulls: { get: pullsGet } } };
    const opts = { token: "t", repo: () => ({ owner: "acme", repo: "widgets" }), getOctokit: () => octokit };
    const api = createGitHubApi(opts as unknown as GitHubApiOptions);
    expect(await api.getPullRequest(42)).toEqual({ baseSha: BASE, headSha: HEAD });
    expect((await api.getPullRequestSignoff(42)).commits).toBe(1);
    expect((await api.getPullRequestSignoff(42)).author).toEqual({ login: "octocat" });
    expect(pullsGet).toHaveBeenCalledTimes(1);
    // Another pull request is its own read.
    await api.getPullRequestSignoff(43);
    expect(pullsGet).toHaveBeenCalledTimes(2);
  });

  it("createGitHubApi does not keep a failed pull request read", async () => {
    const pullsGet = vi
      .fn()
      .mockRejectedValueOnce(new Error("Bad Gateway"))
      .mockResolvedValue({ data: { base: { sha: BASE }, head: { sha: HEAD }, user: null, labels: [], commits: 0 } });
    const octokit = { rest: { pulls: { get: pullsGet } } };
    const opts = { token: "t", repo: () => ({ owner: "acme", repo: "widgets" }), getOctokit: () => octokit };
    const api = createGitHubApi(opts as unknown as GitHubApiOptions);
    await expect(api.getPullRequestSignoff(42)).rejects.toThrow("Bad Gateway");
    expect(await api.getPullRequest(42)).toEqual({ baseSha: BASE, headSha: HEAD });
    expect(pullsGet).toHaveBeenCalledTimes(2);
  });
});

describe("review 48: the tree-truncation warning names P08", () => {
  it("a truncated PR-head tree warns that the forbidden-file rule (P08) may miss files", async () => {
    const h = harness({
      inputs: { "pr-number": "42", "head-sha": HEAD, upload: "never", comment: "false" },
      context: { eventName: "workflow_run", sha: "e".repeat(40), payload: {} },
    });
    h.deps.api = {
      ...h.deps.api,
      getPullRequest: async () => ({ baseSha: BASE, headSha: HEAD }),
      getPullRequestSignoff: async () => ({ author: null, labels: [], commits: 0 }),
      listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
      listTree: async () => ({ paths: ["src/math.ts"], truncated: true }),
    } as typeof h.deps.api;
    await run(h.deps);
    expect(h.failed).toEqual([]);
    const line = h.warnings.find((w) => w.includes("truncated by the GitHub API"));
    expect(line).toContain("P08");
    expect(line).toContain("agent setup scan");
  });
});

describe("review 28: an internal upload error", () => {
  const SECRET_TEXT = "clock exploded near the signed URL";

  async function brokenClockRun(debug: boolean | undefined) {
    const h = harness({ inputs: { threshold: "50", policy: "never" }, context: META_CONTEXT });
    h.deps.api = {
      ...h.deps.api,
      listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
    } as typeof h.deps.api;
    Object.assign(h.deps, {
      fetch: async () => new Response(null, { status: 500 }),
      getIDToken: async () => TOKEN,
      setSecret: () => {},
      hasOidcEnv: true,
      now: () => {
        throw new RangeError(SECRET_TEXT);
      },
      sleep: async () => {},
      ...(debug === undefined ? {} : { debug }),
    });
    const report = await run(h.deps);
    return { h, report };
  }

  it("is logged once with its class, never its message, and the check is not affected", async () => {
    for (const debug of [undefined, false]) {
      const { h, report } = await brokenClockRun(debug);
      expect(report?.meta?.upload).toEqual({ status: "failed" });
      expect(h.failed).toEqual([]);
      const lines = h.warnings.filter((w) => w.includes("was not uploaded"));
      expect(lines).toEqual([
        "pharn-ci: the run was not uploaded to pharn.dev (failed: internal, RangeError); the check is not affected",
      ]);
      for (const line of [...h.warnings, ...h.infos]) expect(line).not.toContain(SECRET_TEXT);
    }
  });

  it("under debug logging is logged the same way and then fails the step with its message", async () => {
    const { h, report } = await brokenClockRun(true);
    expect(report).toBeUndefined();
    expect(h.warnings.filter((w) => w.includes("(failed: internal, RangeError)"))).toHaveLength(1);
    expect(h.failed).toEqual([`pharn-ci: ${SECRET_TEXT}`]);
  });
});
