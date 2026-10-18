import { readFileSync } from "node:fs";
import { type ActionContext, type ActionDeps, commentScopeLine, type IssueComment } from "../src/run.js";

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
export const fixture = (p: string) => readFileSync(new URL(p, FIXTURES), "utf8");

export const WORKSPACE = "/home/runner/work/demo/demo";
export const BOT = { login: "github-actions[bot]" };
/** The scope line of the harness context, which names no workflow or job. */
export const SCOPE = commentScopeLine("", "");
export const PR_CONTEXT: ActionContext = {
  eventName: "pull_request",
  sha: "merge000",
  payload: { pull_request: { number: 7, base: { sha: "a".repeat(40) }, head: { sha: "b".repeat(40) } } },
};

export interface Harness {
  deps: ActionDeps;
  outputs: Record<string, string>;
  failed: string[];
  warnings: string[];
  infos: string[];
  summary: string[];
  written: Record<string, string>;
  comments: IssueComment[];
  /** Every body passed to createComment or updateComment. */
  posted: string[];
  apiCalls: string[];
  gitCalls: string[][];
}

export interface HarnessOptions {
  inputs?: Record<string, string>;
  files?: Record<string, string>;
  context?: ActionContext;
  localGit?: boolean;
  commentError?: Error;
  compareError?: Error;
  existingComments?: IssueComment[];
  /** Comments a concurrent run posts while this run creates its own (a list-then-create race). */
  racingComments?: IssueComment[];
  deleteError?: Error;
  /** Error for listing comments again after creating one. */
  relistError?: Error;
  /** Login the token comments as (default: the GITHUB_TOKEN bot). */
  viewer?: string;
  /** Output of `git rev-parse HEAD` (default: not the PR head). */
  localHead?: string;
  /** Tracked files returned by `git ls-files` (default: fixtures/golden/files.txt). */
  lsFiles?: string[];
  /** Makes `git ls-files` reject. */
  lsFilesError?: Error;
  /** Makes the local `git diff` reject while `git rev-parse` still resolves the base. */
  diffError?: Error;
  /** Makes the job summary write reject. */
  summaryError?: Error;
}

export function harness(opts: HarnessOptions = {}): Harness {
  const h: Harness = {
    outputs: {},
    failed: [],
    warnings: [],
    infos: [],
    summary: [],
    written: {},
    comments: [...(opts.existingComments ?? [])],
    posted: [],
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
    config: "",
    ...opts.inputs,
  };
  const localGit = opts.localGit ?? true;
  const viewer = opts.viewer ?? BOT.login;
  const lsFiles = opts.lsFiles ?? fixture("golden/files.txt").trim().split("\n");
  let nextId = 100;
  let lists = 0;

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
        if (lists++ > 0 && opts.relistError) throw opts.relistError;
        return h.comments.map((c) => ({ ...c }));
      },
      async createComment(n, body) {
        h.apiCalls.push(`create ${n}`);
        h.posted.push(body);
        h.comments.push({ id: nextId++, body, user: { login: viewer } }, ...(opts.racingComments ?? []));
        h.comments.sort((a, b) => a.id - b.id);
        return viewer;
      },
      async updateComment(id, body) {
        h.apiCalls.push(`update ${id}`);
        h.posted.push(body);
        const c = h.comments.find((x) => x.id === id);
        if (c) c.body = body;
      },
      async deleteComment(id) {
        h.apiCalls.push(`delete ${id}`);
        if (opts.deleteError) throw opts.deleteError;
        h.comments = h.comments.filter((x) => x.id !== id);
      },
    },
    async git(args) {
      h.gitCalls.push(args);
      if (args[0] === "ls-files") {
        if (opts.lsFilesError) throw opts.lsFilesError;
        return `${lsFiles.join("\0")}\0`;
      }
      if (args[0] === "ls-tree") return "";
      if (!localGit) throw new Error("fatal: bad object");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return `${opts.localHead ?? "c".repeat(40)}\n`;
      if (args[0] === "rev-parse") return "ok\n";
      if (args[0] === "diff") {
        if (opts.diffError) throw opts.diffError;
        return fixture("golden/pr.diff");
      }
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
    readFile: async (p) => files[p] ?? null,
    async writeFile(p, text) {
      h.written[p] = text;
    },
    resolvePath: (...segments) =>
      segments.reduce((acc, s) => (s.startsWith("/") ? s : `${acc.replace(/\/$/, "")}/${s.replace(/^\.\//, "")}`), ""),
    info: (m) => {
      h.infos.push(m);
    },
    warning: (m) => h.warnings.push(m),
    setOutput: (name, value) => {
      h.outputs[name] = value;
    },
    setFailed: (m) => h.failed.push(m),
    writeSummary: async (md) => {
      h.summary.push(md);
      if (opts.summaryError) throw opts.summaryError;
    },
  };
  return h;
}
