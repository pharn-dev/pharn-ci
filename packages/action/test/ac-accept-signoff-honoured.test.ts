import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// run() is loaded inside each test body, and the fixtures under fixtures/accept-label/ are read there too: the AC
// tests are written before the accept label exists, so nothing the build adds may run while the file loads. The fake
// GitHub API serves the pull request's author and labels (getPullRequestSignoff) and its issue events in pages
// (listIssueEvents), and records every call.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const acceptFixture = (name: string) => read(`fixtures/accept-label/${name}`);

const LABEL = "pharn/accepted";
const HEADING = "### 🔍 Test integrity";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const BOT_AUTHOR = { login: "claude[bot]", type: "Bot" };

type Kind = "pull_request" | "pr-number";
type Page = { events: unknown; hasNext: boolean };
type Signal = { id: string; severity: string; path: string; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };

interface SignoffOptions {
  kind?: Kind;
  inputs?: Record<string, string>;
  diff: string;
  author?: unknown;
  labels?: unknown;
  events?: unknown;
}

function contextFor(kind: Kind) {
  if (kind === "pull_request") return PR_CONTEXT;
  return {
    eventName: "workflow_dispatch",
    sha: "4444444444444444444444444444444444444444",
    ref: "refs/heads/main",
    repo: { owner: "octo", repo: "demo" },
    issue: { owner: "octo", repo: "demo" },
    payload: { inputs: {}, ref: "refs/heads/main" },
  };
}

/** One Action run against the fake API; the PR is #7 on pull_request and #42 in pr-number mode. */
async function signoffRun(options: SignoffOptions) {
  const { run } = await import("../src/run.js");
  const kind = options.kind ?? "pull_request";
  const files = acceptFixture("files.txt").trim().split("\n");
  const prNumberInputs = { "pr-number": "42", "head-sha": HEAD_SHA, "github-token": "test-token" };
  const h = harness({
    inputs: { ...(kind === "pr-number" ? prNumberInputs : {}), ...options.inputs },
    lsFiles: files,
    context: contextFor(kind) as never,
  });
  const signoffCalls: number[] = [];
  const eventCalls: Array<[number, number]> = [];
  const git = h.deps.git;
  h.deps.git = async (args) => (args[0] === "diff" ? options.diff : git(args));
  h.deps.api = {
    ...h.deps.api,
    async compareDiff(basehead: string) {
      h.apiCalls.push(`compare ${basehead}`);
      return options.diff;
    },
    async getPullRequest(pullNumber: number) {
      h.apiCalls.push(`pull ${pullNumber}`);
      return { baseSha: BASE_SHA, headSha: HEAD_SHA };
    },
    async listTree(sha: string) {
      h.apiCalls.push(`tree ${sha}`);
      return { paths: files, truncated: false };
    },
    async getPullRequestSignoff(pullNumber: number) {
      signoffCalls.push(pullNumber);
      return { author: options.author ?? BOT_AUTHOR, labels: options.labels ?? [{ name: LABEL, color: "0e8a16" }] };
    },
    async listIssueEvents(issueNumber: number, page: number): Promise<Page> {
      eventCalls.push([issueNumber, page]);
      const all = options.events ?? [];
      if (!Array.isArray(all)) return { events: all, hasNext: false };
      return { events: all.slice((page - 1) * 100, page * 100), hasNext: all.length > page * 100 };
    },
  } as typeof h.deps.api;
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  const report = text === undefined ? undefined : JSON.parse(text);
  return { h, report, signoffCalls, eventCalls, comment: h.posted.at(-1) ?? "" };
}

/** The lines of the Test integrity section: from its heading to the line before the next `### ` heading. */
function section(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(HEADING);
  if (start === -1) throw new Error("no Test integrity heading");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("### "));
  return [HEADING, ...(end === -1 ? rest : rest.slice(0, end))];
}

const codes = (report: { messages: Message[] }, code: string) => report.messages.filter((m) => m.code === code);

describe("the accept label applied by a reviewer who is not the PR author", () => {
  for (const kind of ["pull_request", "pr-number"] as const) {
    it(`AC-4: a ${kind} run downgrades every block to warn, records who accepted it and passes as warn`, async () => {
      const diff = acceptFixture("block.diff");
      const events = JSON.parse(acceptFixture("events-human.json"));

      // Without the label: the same run, whose TI10 and TI13 signals are block and fail the step.
      const unlabelled = await signoffRun({ kind, diff, labels: [], events, inputs: { "test-integrity": "block" } });
      const before = unlabelled.report.testIntegrity.signals as Signal[];
      expect(before.map((s) => `${s.id} ${s.severity} ${s.path}:${s.line}`)).toEqual([
        "TI10 block package.json:7",
        "TI13 block src/a.ts:12",
      ]);
      expect(unlabelled.h.failed).toHaveLength(1);

      const { h, report, eventCalls, comment } = await signoffRun({
        kind,
        diff,
        events,
        inputs: { "test-integrity": "block" },
      });

      // At most 10 issue-events requests, for this pull request.
      const number = kind === "pull_request" ? 7 : 42;
      expect(eventCalls.length).toBeGreaterThan(0);
      expect(eventCalls.length).toBeLessThanOrEqual(10);
      expect(eventCalls.every(([n]) => n === number)).toBe(true);

      // Every block signal is warn with the same id, path, line and detail.
      expect(report.testIntegrity.signals).toEqual(before.map((s) => ({ ...s, severity: "warn" })));
      expect(report.testIntegrity.verdict).toBe("warn");
      expect(report.verdict).toBe("warn");
      expect(h.outputs.verdict).toBe("warn");
      expect(h.failed).toEqual([]);

      // Who accepted it, under the default label, which is not written as acceptLabel.
      expect(report.testIntegrity.accepted).toEqual({ label: LABEL, by: "Reviewer-1" });
      expect("acceptLabel" in report.testIntegrity).toBe(false);

      const accepted = codes(report, "TEST_INTEGRITY_ACCEPTED");
      expect(accepted).toHaveLength(1);
      expect(accepted[0]?.level).toBe("info");
      expect(accepted[0]?.text).toContain(LABEL);
      expect(accepted[0]?.text).toContain("Reviewer-1");
      expect(codes(report, "TEST_INTEGRITY_ACCEPT_IGNORED")).toEqual([]);
      expect(codes(report, "TEST_INTEGRITY_TI10").map((m) => m.level)).toEqual(["warn"]);
      expect(codes(report, "TEST_INTEGRITY_TI13").map((m) => m.level)).toEqual(["warn"]);

      // The posted comment still lists both findings and says who accepted them.
      expect(h.apiCalls).toContain(`create ${number}`);
      const lines = section(comment);
      expect(lines.some((line) => line.includes("**TI10**") && line.includes("`package.json:7`"))).toBe(true);
      expect(lines.some((line) => line.includes("**TI13**") && line.includes("`src/a.ts:12`"))).toBe(true);
      expect(lines.filter((line) => line.includes(`\`${LABEL}\``) && line.includes("@Reviewer-1"))).toHaveLength(1);

      expectValidReport(report);
    });
  }
});
