import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Report } from "@pharn-ci/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// CORE-69. run() and createNodeIo() are loaded inside the test body: the AC test is written before the Action reads
// the accept label for a per-file TEST_INTEGRITY_INDEX_UNAVAILABLE error with no block finding, so nothing the build
// changes may run while the file loads. Git is real (one temporary repository whose feature commit nests an array
// literal in src/deep.test.ts deeper than the test index walks); the fake GitHub API serves the pull request's author
// and labels (getPullRequestSignoff) and its issue events (listIssueEvents).

const PATH = "src/deep.test.ts";
const LABEL = "pharn/accepted";
const AUTHOR = { login: "octo-author", type: "User" };
const REVIEWER = { login: "Reviewer-1", type: "User" };
const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";

const BASE = [
  'import { expect, it } from "vitest";',
  'import { total } from "./math.js";',
  "",
  'it("adds the prices", () => {',
  "  expect(total([2, 3])).toBe(5);",
  "});",
  "",
  'it("rejects a negative price", () => {',
  '  expect(() => total([-1])).toThrow("negative price");',
  "});",
  "",
].join("\n");
const HEAD = `${BASE}const deep = ${"[".repeat(2000)}${"]".repeat(2000)};\n`;

let dir: string;
let baseId: string;
let headId: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-core69-accept-action-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/math.ts"), "export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n");
  writeFileSync(join(dir, PATH), BASE);
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  baseId = sh("rev-parse", "HEAD").trim();
  sh("checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, PATH), HEAD);
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  headId = sh("rev-parse", "HEAD").trim();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** One pull_request Action run in mode block whose accept label's newest `labeled` event was made by `actor`. */
async function labelledRun(actor: { login: string; type: string }) {
  const { run } = await import("../src/run.js");
  const { createNodeIo } = await import("../src/node-io.js");
  const h = harness({
    inputs: { "test-integrity": "block" },
    files: { [`${dir}/coverage/lcov.info`]: `SF:${dir}/src/math.ts\nDA:1,1\nend_of_record\n` },
    context: {
      ...PR_CONTEXT,
      payload: { pull_request: { number: 7, base: { sha: baseId }, head: { sha: headId } } },
    },
  });
  const io = createNodeIo(dir);
  const deps = h.deps;
  deps.workspace = dir;
  deps.git = io.git;
  deps.gitStream = io.gitStream;
  if (io.gitBatch) deps.gitBatch = io.gitBatch;
  deps.listDir = io.listDir;
  const events = [
    {
      id: 2001,
      event: "labeled",
      actor,
      label: { name: LABEL, color: "0e8a16" },
      created_at: "2026-11-17T10:00:00Z",
    },
  ];
  const eventCalls: number[] = [];
  deps.api = {
    ...h.deps.api,
    async getPullRequestSignoff(_pullNumber: number) {
      return { author: AUTHOR, labels: [{ name: LABEL, color: "0e8a16" }], commits: undefined };
    },
    async listIssueEvents(_issueNumber: number, page: number) {
      eventCalls.push(page);
      return { events: page === 1 ? events : [], hasNext: false };
    },
  };
  await run(h.deps as never);
  const text = h.written[h.outputs["report-path"] ?? ""];
  expect(text, "the Action wrote report.json").toBeDefined();
  const report = JSON.parse(text as string) as Report;
  expectValidReport(report);
  return { h, report, eventCalls };
}

const codes = (report: Report, code: string) => report.messages.filter((m) => m.code === code);

describe("action: the accept label lifts a per-file unreadable error", () => {
  it("AC-18: a non-author's label lifts the AC-1 per-file error and the step passes; the PR author's label is ignored and the step fails", async () => {
    const reviewer = await labelledRun(REVIEWER);
    expect(reviewer.eventCalls.length, "the Action read the label's events").toBeGreaterThan(0);
    expect(codes(reviewer.report, "TEST_INTEGRITY_ACCEPTED"), "TEST_INTEGRITY_ACCEPTED").toHaveLength(1);
    expect(
      codes(reviewer.report, CODE).map((m) => m.level),
      `${CODE} lowered to warn`,
    ).toEqual(["warn"]);
    expect(codes(reviewer.report, CODE)[0]?.text).toContain(PATH);
    expect(reviewer.h.failed, "the step does not fail").toEqual([]);

    const author = await labelledRun(AUTHOR);
    expect(codes(author.report, "TEST_INTEGRITY_ACCEPT_IGNORED"), "TEST_INTEGRITY_ACCEPT_IGNORED").toHaveLength(1);
    expect(codes(author.report, "TEST_INTEGRITY_ACCEPTED")).toEqual([]);
    expect(
      codes(author.report, CODE).map((m) => m.level),
      `${CODE} stays an error`,
    ).toEqual(["error"]);
    expect(author.report.verdict).toBe("fail");
    expect(author.h.failed, "the step fails").toHaveLength(1);
  }, 60_000);
});
