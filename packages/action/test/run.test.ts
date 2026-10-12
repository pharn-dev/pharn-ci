import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type ActionContext, type ActionDeps, COMMENT_MARKER, type IssueComment, run } from "../src/run.js";

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (p: string) => readFileSync(new URL(p, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
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
      async listComments(n) {
        h.apiCalls.push(`list ${n}`);
        if (opts.commentError) throw opts.commentError;
        return h.comments;
      },
      async createComment(n, body) {
        h.apiCalls.push(`create ${n}`);
        h.comments.push({ id: nextId++, body });
      },
      async updateComment(id, body) {
        h.apiCalls.push(`update ${id}`);
        const c = h.comments.find((x) => x.id === id);
        if (c) c.body = body;
      },
    },
    async git(args) {
      h.gitCalls.push(args);
      if (args[0] === "ls-files") return `${fixture("golden/files.txt").trim().split("\n").join("\0")}\0`;
      if (!localGit) throw new Error("fatal: bad object");
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

  it("prefers origin/<ref> for a base-ref input", async () => {
    const h = harness({ inputs: { "base-ref": "develop" } });
    await run(h.deps);
    expect(h.gitCalls.find((a) => a[0] === "diff")?.at(-1)).toBe("origin/develop...HEAD");
  });

  it("updates the existing sticky comment instead of posting a duplicate", async () => {
    const h = harness({
      existingComments: [
        { id: 1, body: "unrelated" },
        { id: 2, body: `${COMMENT_MARKER}\nold report` },
      ],
    });
    await run(h.deps);
    await run(h.deps);
    expect(h.comments).toHaveLength(2);
    expect(h.comments[1]?.body).toContain("pharn-ci: pass");
    expect(h.apiCalls.filter((c) => c.startsWith("create"))).toEqual([]);
    expect(h.apiCalls.filter((c) => c.startsWith("update"))).toEqual(["update 2", "update 2"]);
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
    [{ "coverage-format": "cobertura" }, 'coverage-format "cobertura" is not supported yet'],
    [{ threshold: "abc" }, "threshold must be a number"],
    [{ comment: "maybe" }, "comment must be true or false"],
    [{ "coverage-file": "" }, "no coverage file"],
  ])("fails clearly for invalid inputs %j", async (inputs, message) => {
    const h = harness({ inputs });
    expect(await run(h.deps)).toBeUndefined();
    expect(h.failed[0]).toContain(message);
  });
});
