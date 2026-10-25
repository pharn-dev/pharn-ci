import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// run() is loaded inside each test body, and the fixtures under fixtures/accept-label/ are read there too: the AC
// tests are written before the accept label exists, so nothing the build adds may run while the file loads. The fake
// GitHub API serves the pull request's author and labels (getPullRequestSignoff) and its issue events in pages
// (listIssueEvents).

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const acceptFixture = (name: string) => read(`fixtures/accept-label/${name}`);

const LABEL = "pharn/accepted";
const AUTHOR = { login: "octo-author", type: "User" };

type Page = { events: unknown; hasNext: boolean };
type Message = { level: string; code: string; text: string };

/** One pull_request Action run (PR #7) in mode block on the block diff, against the fake API. */
async function signoffRun(events: unknown[]) {
  const { run } = await import("../src/run.js");
  const diff = acceptFixture("block.diff");
  const h = harness({
    inputs: { "test-integrity": "block" },
    lsFiles: acceptFixture("files.txt").trim().split("\n"),
    context: PR_CONTEXT,
  });
  const git = h.deps.git;
  h.deps.git = async (args) => (args[0] === "diff" ? diff : git(args));
  h.deps.api = {
    ...h.deps.api,
    async compareDiff(basehead: string) {
      h.apiCalls.push(`compare ${basehead}`);
      return diff;
    },
    async getPullRequestSignoff(_pullNumber: number) {
      return { author: AUTHOR, labels: [{ name: LABEL, color: "0e8a16" }] };
    },
    async listIssueEvents(_issueNumber: number, page: number): Promise<Page> {
      return { events: events.slice((page - 1) * 100, page * 100), hasNext: events.length > page * 100 };
    },
  } as typeof h.deps.api;
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  const report = text === undefined ? undefined : JSON.parse(text);
  return { h, report };
}

const codes = (report: { messages: Message[] }, code: string) => report.messages.filter((m) => m.code === code);

describe("the newest labeling event decides", () => {
  it("AC-8: Reviewer-1 labels, the author unlabels and labels again: not honoured, the PR author applied it", async () => {
    const { h, report } = await signoffRun(JSON.parse(acceptFixture("events-applied-twice-author-last.json")));

    expect(report.testIntegrity.accepted ?? null).toBeNull();
    expect(report.testIntegrity.signals.map((s: { severity: string }) => s.severity)).toEqual(["block", "block"]);
    expect(h.failed).toHaveLength(1);
    const ignored = codes(report, "TEST_INTEGRITY_ACCEPT_IGNORED");
    expect(ignored).toHaveLength(1);
    expect(ignored[0]?.level).toBe("warn");
    expect(ignored[0]?.text).toMatch(/author/i);
    expect(ignored[0]?.text).not.toMatch(/octo-author|Reviewer-1/i);
    expect(codes(report, "TEST_INTEGRITY_ACCEPTED")).toEqual([]);
    expectValidReport(report);
  });

  it("AC-8: the author labels and unlabels, then Reviewer-1 labels: honoured, accepted by Reviewer-1", async () => {
    const { h, report } = await signoffRun(JSON.parse(acceptFixture("events-applied-twice-reviewer-last.json")));

    expect(report.testIntegrity.accepted).toEqual({ label: LABEL, by: "Reviewer-1" });
    expect(report.testIntegrity.signals.map((s: { severity: string }) => s.severity)).toEqual(["warn", "warn"]);
    expect(h.failed).toEqual([]);
    expect(codes(report, "TEST_INTEGRITY_ACCEPT_IGNORED")).toEqual([]);
    expect(codes(report, "TEST_INTEGRITY_ACCEPTED")).toHaveLength(1);
    expectValidReport(report);
  });
});
