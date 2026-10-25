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
const BOT_AUTHOR = { login: "claude[bot]", type: "Bot" };

type Kind = "pull_request" | "push" | "merge_group";
type Page = { events: unknown; hasNext: boolean };
type Message = { level: string; code: string; text: string };

interface SignoffOptions {
  kind?: Kind;
  mode: "block" | "warn" | "off";
  diff: string;
  labels?: unknown;
}

function contextFor(kind: Kind) {
  if (kind === "pull_request") return PR_CONTEXT;
  if (kind === "push") return { eventName: "push", sha: "c1", payload: { before: "f".repeat(40) } };
  return {
    eventName: "merge_group",
    sha: "c1",
    payload: { merge_group: { base_sha: "d".repeat(40), head_sha: "e".repeat(40) } },
  };
}

/** One Action run against the fake API, whose pull request carries the label applied by Reviewer-1 unless told. */
async function signoffRun(options: SignoffOptions) {
  const { run } = await import("../src/run.js");
  const h = harness({
    inputs: { "test-integrity": options.mode },
    lsFiles: acceptFixture("files.txt").trim().split("\n"),
    context: contextFor(options.kind ?? "pull_request") as never,
  });
  const events = JSON.parse(acceptFixture("events-human.json")) as unknown[];
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
    async getPullRequestSignoff(pullNumber: number) {
      signoffCalls.push(pullNumber);
      return { author: BOT_AUTHOR, labels: options.labels ?? [{ name: LABEL, color: "0e8a16" }] };
    },
    async listIssueEvents(issueNumber: number, page: number): Promise<Page> {
      eventCalls.push([issueNumber, page]);
      return { events: events.slice((page - 1) * 100, page * 100), hasNext: events.length > page * 100 };
    },
  } as typeof h.deps.api;
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  const report = text === undefined ? undefined : JSON.parse(text);
  return { h, report, signoffCalls, eventCalls };
}

const codes = (report: { messages: Message[] }, code: string) => report.messages.filter((m) => m.code === code);
const severities = (report: { testIntegrity: { signals: { id: string; severity: string }[] } }) =>
  report.testIntegrity.signals.map((s) => `${s.id} ${s.severity}`);

/** Nothing about the label happened: no events request, no accept message, no accepted record. */
function expectNotAsked(run: Awaited<ReturnType<typeof signoffRun>>) {
  expect(run.eventCalls).toEqual([]);
  expect(codes(run.report, "TEST_INTEGRITY_ACCEPTED")).toEqual([]);
  expect(codes(run.report, "TEST_INTEGRITY_ACCEPT_IGNORED")).toEqual([]);
  expect(run.report.testIntegrity.accepted ?? null).toBeNull();
  expectValidReport(run.report);
}

describe("the accept label is only looked at in mode block, with a block signal, on a pull request that carries it", () => {
  it("AC-3: control: the same `|| true` diff in mode block on the labelled pull request is accepted", async () => {
    const run = await signoffRun({ mode: "block", diff: acceptFixture("or-true.diff") });

    expect(run.eventCalls.length).toBeGreaterThan(0);
    expect(severities(run.report)).toEqual(["TI10 warn"]);
    expect(run.report.testIntegrity.accepted).toEqual({ label: LABEL, by: "Reviewer-1" });
  });

  it("AC-3: modes warn and off on the labelled pull request ask nothing and keep their severities", async () => {
    const warn = await signoffRun({ mode: "warn", diff: acceptFixture("or-true.diff") });
    expectNotAsked(warn);
    expect(severities(warn.report)).toEqual(["TI10 warn"]);
    expect(warn.h.failed).toEqual([]);

    const off = await signoffRun({ mode: "off", diff: acceptFixture("or-true.diff") });
    expectNotAsked(off);
    expect(severities(off.report)).toEqual([]);
    expect(off.h.failed).toEqual([]);
  });

  it("AC-3: mode block on the labelled pull request with only a warn signal, or no signal, asks nothing", async () => {
    const warnOnly = await signoffRun({ mode: "block", diff: acceptFixture("warn-only.diff") });
    expectNotAsked(warnOnly);
    expect(severities(warnOnly.report)).toEqual(["TI03 warn"]);
    expect(warnOnly.h.failed).toEqual([]);

    const none = await signoffRun({ mode: "block", diff: acceptFixture("no-signal.diff") });
    expectNotAsked(none);
    expect(severities(none.report)).toEqual([]);
    expect(none.h.failed).toEqual([]);
  });

  it("AC-3: mode block with a block signal on an unlabelled pull request, a push and a merge_group run keeps the block and fails", async () => {
    const unlabelled = await signoffRun({
      mode: "block",
      diff: acceptFixture("or-true.diff"),
      labels: [{ name: "bug", color: "d73a4a" }],
    });
    const push = await signoffRun({ kind: "push", mode: "block", diff: acceptFixture("or-true.diff") });
    const mergeGroup = await signoffRun({ kind: "merge_group", mode: "block", diff: acceptFixture("or-true.diff") });

    for (const [name, run] of [
      ["unlabelled", unlabelled],
      ["push", push],
      ["merge_group", mergeGroup],
    ] as const) {
      expectNotAsked(run);
      expect(severities(run.report), name).toEqual(["TI10 block"]);
      expect(run.report.verdict, name).toBe("fail");
      expect(run.h.failed, name).toHaveLength(1);
    }
  });
});
