import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createGitHubApi } from "../src/api.js";
import {
  type ActionContext,
  type ActionDeps,
  COMMENT_MARKER,
  type IssueComment,
  MAX_COMMENT_LENGTH,
  run,
} from "../src/run.js";

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (p: string) => readFileSync(new URL(p, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BOT = { login: "github-actions[bot]" };
const PR_CONTEXT: ActionContext = {
  eventName: "pull_request",
  sha: "merge000",
  payload: { pull_request: { number: 7, base: { sha: "a".repeat(40) }, head: { sha: "b".repeat(40) } } },
};

interface Harness {
  deps: ActionDeps;
  outputs: Record<string, string>;
  failed: string[];
  warnings: string[];
  summary: string[];
  written: Record<string, string>;
  comments: IssueComment[];
  apiCalls: string[];
  gitCalls: string[][];
}

interface Options {
  inputs?: Record<string, string>;
  files?: Record<string, string>;
  context?: ActionContext;
  localGit?: boolean;
  commentError?: Error;
  compareError?: Error;
  existingComments?: IssueComment[];
  /** Login the token comments as (default: the GITHUB_TOKEN bot). */
  viewer?: string;
  /** Output of `git rev-parse HEAD` (default: not the PR head). */
  localHead?: string;
  /** Tracked files returned by `git ls-files` (default: fixtures/golden/files.txt). */
  lsFiles?: string[];
}

function harness(opts: Options = {}): Harness {
  const h: Harness = {
    outputs: {},
    failed: [],
    warnings: [],
    summary: [],
    written: {},
    comments: [...(opts.existingComments ?? [])],
    apiCalls: [],
    gitCalls: [],
    deps: undefined as never,
  };
  const files: Record<string, string> = {
    [`${WORKSPACE}/coverage/lcov.info`]: fixture("golden/coverage.info"),
    ...opts.files,
  };
  const inputs: Record<string, string> = {
    "coverage-file": "coverage/lcov.info",
    comment: "true",
    "fail-on-threshold": "true",
    config: ".pharn/ci.yml",
    ...opts.inputs,
  };
  const localGit = opts.localGit ?? true;
  const viewer = opts.viewer ?? BOT.login;
  const lsFiles = opts.lsFiles ?? fixture("golden/files.txt").trim().split("\n");
  let nextId = 100;

  h.deps = {
    getInput: (name) => inputs[name] ?? "",
    context: opts.context ?? PR_CONTEXT,
    workspace: WORKSPACE,
    tempDir: "/tmp/runner",
    api: {
      async compareDiff(basehead) {
        h.apiCalls.push(`compare ${basehead}`);
        if (opts.compareError) throw opts.compareError;
        return fixture("golden/pr.diff");
      },
      viewerLogin: async () => viewer,
      async listComments(n) {
        h.apiCalls.push(`list ${n}`);
        if (opts.commentError) throw opts.commentError;
        return h.comments;
      },
      async createComment(n, body) {
        h.apiCalls.push(`create ${n}`);
        h.comments.push({ id: nextId++, body, user: { login: viewer } });
      },
      async updateComment(id, body) {
        h.apiCalls.push(`update ${id}`);
        const c = h.comments.find((x) => x.id === id);
        if (c) c.body = body;
      },
    },
    async git(args) {
      h.gitCalls.push(args);
      if (args[0] === "ls-files") return `${lsFiles.join("\0")}\0`;
      if (!localGit) throw new Error("fatal: bad object");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return `${opts.localHead ?? "c".repeat(40)}\n`;
      if (args[0] === "rev-parse") return "ok\n";
      if (args[0] === "diff") return fixture("golden/pr.diff");
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
    readFile: async (p) => files[p] ?? null,
    async writeFile(p, text) {
      h.written[p] = text;
    },
    resolvePath: (...segments) =>
      segments.reduce((acc, s) => (s.startsWith("/") ? s : `${acc.replace(/\/$/, "")}/${s.replace(/^\.\//, "")}`), ""),
    info: () => {},
    warning: (m) => h.warnings.push(m),
    setOutput: (name, value) => {
      h.outputs[name] = value;
    },
    setFailed: (m) => h.failed.push(m),
    writeSummary: async (md) => {
      h.summary.push(md);
    },
  };
  return h;
}

describe("action run", () => {
  it("writes report.json, outputs, job summary and a sticky comment, and fails below threshold", async () => {
    const h = harness({ inputs: { threshold: "80" } });
    const report = await run(h.deps);

    expect(report?.verdict).toBe("fail");
    expect(h.outputs).toEqual({
      "report-path": "/tmp/runner/pharn-ci/report.json",
      verdict: "fail",
      "diff-coverage": "71.43",
    });
    expect(JSON.parse(h.written["/tmp/runner/pharn-ci/report.json"] as string)).toEqual(report);
    expect(h.summary[0]).toContain("pharn-ci: fail");
    expect(h.comments).toHaveLength(1);
    expect(h.comments[0]?.body?.startsWith(`${COMMENT_MARKER}\n## ❌ pharn-ci: fail`)).toBe(true);
    expect(h.failed).toEqual(["pharn-ci: Diff coverage 71.43% is below the threshold of 80%."]);
  });

  it("diffs locally against the PR base sha when history is available", async () => {
    const h = harness();
    await run(h.deps);
    expect(h.gitCalls.find((a) => a[0] === "diff")?.at(-1)).toBe(`${"a".repeat(40)}...HEAD`);
    expect(h.apiCalls.filter((c) => c.startsWith("compare"))).toEqual([]);
  });

  it("falls back to the GitHub compare API without local history", async () => {
    const h = harness({ localGit: false });
    const report = await run(h.deps);
    expect(h.apiCalls).toContain(`compare ${"a".repeat(40)}...merge000`);
    expect(report?.diffCoverage?.percent).toBe(71.43);
  });

  it("uses the PR head sha for pull_request_target", async () => {
    const h = harness({ localGit: false, context: { ...PR_CONTEXT, eventName: "pull_request_target" } });
    await run(h.deps);
    expect(h.apiCalls).toContain(`compare ${"a".repeat(40)}...${"b".repeat(40)}`);
  });

  it("refuses to measure a pull_request_target run that checked out the base branch", async () => {
    const h = harness({ inputs: { threshold: "80" }, context: { ...PR_CONTEXT, eventName: "pull_request_target" } });
    const report = await run(h.deps);
    expect(report?.verdict).toBe("fail");
    expect(report?.messages[0]?.code).toBe("DIFF_UNAVAILABLE");
    expect(report?.messages[0]?.text).toContain("check out the PR head");
    expect(h.gitCalls.filter((a) => a[0] === "diff")).toEqual([]);
  });

  it("diffs locally on pull_request_target when the PR head is checked out", async () => {
    const h = harness({ localHead: "b".repeat(40), context: { ...PR_CONTEXT, eventName: "pull_request_target" } });
    const report = await run(h.deps);
    expect(h.gitCalls.find((a) => a[0] === "diff")?.at(-1)).toBe(`${"a".repeat(40)}...HEAD`);
    expect(report?.diffCoverage?.percent).toBe(71.43);
  });

  it("passes the base to git diff after --end-of-options", async () => {
    const h = harness();
    await run(h.deps);
    expect(h.gitCalls.find((a) => a[0] === "diff")?.slice(-2)).toEqual([
      "--end-of-options",
      `${"a".repeat(40)}...HEAD`,
    ]);
  });

  it("passes the candidate base to git rev-parse --verify after --end-of-options", async () => {
    const h = harness({ inputs: { "base-ref": "develop" } });
    await run(h.deps);
    expect(h.gitCalls.filter((a) => a[0] === "rev-parse" && a[1] === "--verify")).toEqual([
      ["rev-parse", "--verify", "--quiet", "--end-of-options", "origin/develop^{commit}"],
    ]);
  });

  it("keeps a base that starts with -x after --end-of-options in every git call", async () => {
    // A push payload's `before` bypasses the base-ref input check, so only --end-of-options guards it.
    const h = harness({ localGit: false, context: { eventName: "push", sha: "c1", payload: { before: "-x" } } });
    await run(h.deps);
    expect(h.gitCalls.filter((a) => a[0] === "rev-parse")).toEqual([
      ["rev-parse", "--verify", "--quiet", "--end-of-options", "origin/-x^{commit}"],
      ["rev-parse", "--verify", "--quiet", "--end-of-options", "-x^{commit}"],
    ]);
    expect(h.gitCalls.filter((a) => a[0] === "diff")).toEqual([]);
    expect(h.apiCalls).toContain("compare -x...c1");
  });

  it("prefers origin/<ref> for a base-ref input", async () => {
    const h = harness({ inputs: { "base-ref": "develop" } });
    await run(h.deps);
    expect(h.gitCalls.find((a) => a[0] === "diff")?.at(-1)).toBe("origin/develop...HEAD");
  });

  it("updates the existing sticky comment instead of posting a duplicate", async () => {
    const h = harness({
      existingComments: [
        { id: 1, body: "unrelated", user: { login: "someone" } },
        { id: 2, body: `${COMMENT_MARKER}\nold report`, user: BOT },
      ],
    });
    await run(h.deps);
    await run(h.deps);
    expect(h.comments).toHaveLength(2);
    expect(h.comments[1]?.body).toContain("pharn-ci: pass");
    expect(h.apiCalls.filter((c) => c.startsWith("create"))).toEqual([]);
    expect(h.apiCalls.filter((c) => c.startsWith("update"))).toEqual(["update 2", "update 2"]);
  });

  it("never takes over a marker comment written by someone else", async () => {
    const forged = `${COMMENT_MARKER}\n## ✅ pharn-ci: pass`;
    const quoted = `> earlier report\n${COMMENT_MARKER}`;
    const h = harness({
      inputs: { threshold: "80" },
      existingComments: [
        { id: 1, body: forged, user: { login: "mallory" } },
        { id: 2, body: quoted, user: BOT },
      ],
    });
    await run(h.deps);
    expect(h.apiCalls.filter((c) => c.startsWith("update"))).toEqual([]);
    expect(h.apiCalls.filter((c) => c.startsWith("create"))).toEqual(["create 7"]);
    expect(h.comments[0]?.body).toBe(forged);
    expect(h.comments[1]?.body).toBe(quoted);
    expect(h.comments[2]?.body?.startsWith(`${COMMENT_MARKER}\n## ❌ pharn-ci: fail`)).toBe(true);
  });

  it("updates the comment of a non-default token's own login", async () => {
    const h = harness({
      viewer: "release-bot",
      existingComments: [
        { id: 1, body: `${COMMENT_MARKER}\nby the default token`, user: BOT },
        { id: 2, body: `${COMMENT_MARKER}\nold`, user: { login: "release-bot" } },
      ],
    });
    await run(h.deps);
    expect(h.apiCalls.filter((c) => c.startsWith("update") || c.startsWith("create"))).toEqual(["update 2"]);
  });

  it("truncates a comment over GitHub's size limit and keeps the full report in the summary", async () => {
    const long = Array.from({ length: 50 }, (_, i) => `.claude/skills/${"x".repeat(2000)}${i}/SKILL.md`);
    const h = harness({ lsFiles: long });
    await run(h.deps);
    const body = h.comments[0]?.body ?? "";
    expect(body.length).toBeLessThanOrEqual(MAX_COMMENT_LENGTH);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toMatch(/_Truncated: the full report is in the job summary and report\.json\._\n$/);
    expect(h.summary[0]?.length).toBeGreaterThan(MAX_COMMENT_LENGTH);
  });

  it("falls back to the job summary when it cannot comment (fork PRs)", async () => {
    const h = harness({ commentError: new Error("Resource not accessible by integration") });
    const report = await run(h.deps);
    expect(report?.verdict).toBe("pass");
    expect(h.summary).toHaveLength(1);
    expect(h.warnings.join("\n")).toContain("could not post the PR comment (Resource not accessible by integration)");
    expect(h.failed).toEqual([]);
  });

  it("does not comment when comment is false", async () => {
    const h = harness({ inputs: { comment: "false" } });
    await run(h.deps);
    expect(h.apiCalls.filter((c) => !c.startsWith("compare"))).toEqual([]);
  });

  describe("with an empty github-token", () => {
    const tokenless = (h: Harness) => {
      const getOctokit = vi.fn(() => {
        throw new Error("no client should be built without a token");
      });
      h.deps.api = createGitHubApi({ token: "", repo: () => ({ owner: "acme", repo: "demo" }), getOctokit });
      return getOctokit;
    };

    it("runs with comment: false and a local diff, making no API call", async () => {
      const h = harness({ inputs: { comment: "false", threshold: "50" } });
      const getOctokit = tokenless(h);
      const report = await run(h.deps);
      expect(report?.verdict).toBe("pass");
      expect(report?.diffCoverage?.percent).toBeTypeOf("number");
      expect(h.failed).toEqual([]);
      expect(h.warnings).toEqual([]);
      expect(h.summary).toHaveLength(1);
      expect(h.outputs.verdict).toBe("pass");
      expect(getOctokit).not.toHaveBeenCalled();
    });

    it("degrades to DIFF_UNAVAILABLE when the compare fallback needs the token", async () => {
      const h = harness({ inputs: { comment: "false" }, localGit: false });
      const getOctokit = tokenless(h);
      const report = await run(h.deps);
      expect(report?.messages[0]?.code).toBe("DIFF_UNAVAILABLE");
      expect(h.warnings.join("\n")).toContain("could not fetch the diff from the GitHub API");
      expect(h.warnings.join("\n")).toContain("the github-token input is empty");
      expect(h.failed).toEqual([]);
      expect(getOctokit).not.toHaveBeenCalled();
    });

    it("warns and keeps the job summary when commenting needs the token", async () => {
      const h = harness();
      const getOctokit = tokenless(h);
      const report = await run(h.deps);
      expect(report?.verdict).toBe("pass");
      expect(h.summary).toHaveLength(1);
      expect(h.warnings.join("\n")).toContain("could not post the PR comment (the github-token input is empty)");
      expect(h.failed).toEqual([]);
      expect(getOctokit).not.toHaveBeenCalled();
    });
  });

  it("does not fail the step when fail-on-threshold is false", async () => {
    const h = harness({ inputs: { threshold: "80", "fail-on-threshold": "false" } });
    expect((await run(h.deps))?.verdict).toBe("fail");
    expect(h.failed).toEqual([]);
  });

  it("reads defaults from .pharn/ci.yml, with inputs overriding them", async () => {
    const files = {
      [`${WORKSPACE}/.pharn/ci.yml`]: "coverage:\n  file: cov.info\n  threshold: 90\n",
      [`${WORKSPACE}/cov.info`]: fixture("golden/coverage.info"),
    };
    const fromConfig = harness({ files, inputs: { "coverage-file": "" } });
    expect((await run(fromConfig.deps))?.diffCoverage?.threshold).toBe(90);
    const overridden = harness({ files, inputs: { "coverage-file": "", threshold: "70" } });
    expect((await run(overridden.deps))?.verdict).toBe("pass");
  });

  it("reports a missing coverage file", async () => {
    const h = harness({ inputs: { "coverage-file": "nope.info", threshold: "80" } });
    const report = await run(h.deps);
    expect(report?.messages[0]?.code).toBe("COVERAGE_FILE_MISSING");
    expect(h.failed).toEqual(["pharn-ci: Coverage file not found: nope.info"]);
  });

  it("warns when there is no base on a push without a previous commit", async () => {
    const h = harness({ context: { eventName: "push", sha: "c1", payload: { before: "0".repeat(40) } } });
    const report = await run(h.deps);
    expect(report?.verdict).toBe("warn");
    expect(report?.messages[0]?.code).toBe("DIFF_UNAVAILABLE");
    expect(h.apiCalls).toEqual([]);
  });

  it("diffs against the previous commit on push", async () => {
    const h = harness({ context: { eventName: "push", sha: "c1", payload: { before: "f".repeat(40) } } });
    await run(h.deps);
    expect(h.gitCalls.find((a) => a[0] === "diff")?.at(-1)).toBe(`${"f".repeat(40)}...HEAD`);
  });

  it("warns when the diff cannot be fetched at all", async () => {
    const h = harness({ localGit: false, compareError: new Error("diff too large") });
    const report = await run(h.deps);
    expect(report?.messages[0]?.code).toBe("DIFF_UNAVAILABLE");
    expect(h.warnings.join("\n")).toContain("diff too large");
  });

  it.each([
    [{ "coverage-format": "clover" }, 'coverage-format "clover" is not supported (supported: lcov, cobertura, auto)'],
    [{ threshold: "abc" }, "threshold must be a number"],
    [{ comment: "maybe" }, "comment must be true or false"],
    [{ "coverage-file": "" }, "no coverage file"],
    [{ "base-ref": "--output=/tmp/x" }, 'base-ref "--output=/tmp/x" must not start with "-"'],
  ])("fails clearly for invalid inputs %j", async (inputs, message) => {
    const h = harness({ inputs });
    expect(await run(h.deps)).toBeUndefined();
    expect(h.failed[0]).toContain(message);
  });
});
