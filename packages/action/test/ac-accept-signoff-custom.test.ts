import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT, WORKSPACE } from "./harness.js";

// run() is loaded inside each test body, and the fixtures under fixtures/accept-label/ are read there too: the AC
// tests are written before the accept label exists, so nothing the build adds may run while the file loads. The fake
// GitHub API serves the pull request's author and labels (getPullRequestSignoff) and its issue events in pages
// (listIssueEvents), and records every call.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const acceptFixture = (name: string) => read(`fixtures/accept-label/${name}`);

const LABEL = "pharn/accepted";
const CUSTOM = "team/tests-ok";
const HEADING = "### 🔍 Test integrity";
const BOT_AUTHOR = { login: "claude[bot]", type: "Bot" };
/** Line 12 of src/a.ts, the line the block diff adds, not covered: diff coverage 0% against a threshold of 80. */
const UNCOVERED = "TN:\nSF:src/a.ts\nDA:12,0\nend_of_record\n";

type Page = { events: unknown; hasNext: boolean };
type Event = { event: string; actor: unknown; label?: { name: string } };
type Message = { level: string; code: string; text: string };

interface SignoffOptions {
  inputs?: Record<string, string>;
  diff: string;
  labels?: unknown;
  events?: unknown;
  coverage?: string;
}

/** One pull_request Action run (PR #7) against the fake API. */
async function signoffRun(options: SignoffOptions) {
  const { run } = await import("../src/run.js");
  const h = harness({
    inputs: { ...options.inputs },
    lsFiles: acceptFixture("files.txt").trim().split("\n"),
    context: PR_CONTEXT,
    ...(options.coverage === undefined ? {} : { files: { [`${WORKSPACE}/coverage/lcov.info`]: options.coverage } }),
  });
  const eventCalls: Array<[number, number]> = [];
  const git = h.deps.git;
  h.deps.git = async (args) => (args[0] === "diff" ? options.diff : git(args));
  h.deps.api = {
    ...h.deps.api,
    async compareDiff(basehead: string) {
      h.apiCalls.push(`compare ${basehead}`);
      return options.diff;
    },
    async getPullRequestSignoff(_pullNumber: number) {
      return { author: BOT_AUTHOR, labels: options.labels ?? [{ name: LABEL, color: "0e8a16" }] };
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
  return { h, report, eventCalls, comment: h.posted.at(-1) ?? "" };
}

/** events-human.json with every event for `pharn/accepted` renamed to `name`. */
function humanEventsFor(name: string): Event[] {
  const events = JSON.parse(acceptFixture("events-human.json")) as Event[];
  return events.map((e) => (e.label?.name === LABEL ? { ...e, label: { ...e.label, name } } : e));
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

/** The hint line under the finding of `id` in the Test integrity section, and under its message code. */
function hintsOf(markdown: string, id: string): string[] {
  const lines = section(markdown);
  const finding = lines.findIndex((line) => line.includes(`**${id}**`));
  expect(finding, `finding ${id}`).toBeGreaterThan(-1);
  // The comment-layout change leaves a signal's message out of the Messages section on purpose: its finding and hint
  // are listed above, so the hint under the finding is the only one in the comment.
  expect(markdown, `message ${id}`).not.toContain(`\`TEST_INTEGRITY_${id}\``);
  const hints = [lines[finding + 1] ?? ""];
  for (const hint of hints) expect(hint.startsWith("  - Hint: "), `hint ${id}`).toBe(true);
  return hints;
}

const codes = (report: { messages: Message[] }, code: string) => report.messages.filter((m) => m.code === code);
const severities = (report: { testIntegrity: { signals: { id: string; severity: string }[] } }) =>
  report.testIntegrity.signals.map((s) => `${s.id} ${s.severity}`);

describe("a configured accept label, label case, and a failing diff coverage", () => {
  it("AC-5: a pull request carrying the configured label team/tests-ok is accepted under that name", async () => {
    const { report, eventCalls, h } = await signoffRun({
      diff: acceptFixture("block.diff"),
      inputs: { "test-integrity": "block", "accept-label": CUSTOM },
      labels: [{ name: CUSTOM, color: "0e8a16" }],
      events: humanEventsFor(CUSTOM),
    });

    expect(eventCalls.length).toBeGreaterThan(0);
    expect(report.testIntegrity.accepted).toEqual({ label: CUSTOM, by: "Reviewer-1" });
    expect(report.testIntegrity.acceptLabel).toBe(CUSTOM);
    expect(severities(report)).toEqual(["TI10 warn", "TI13 warn"]);
    expect(codes(report, "TEST_INTEGRITY_ACCEPTED")).toHaveLength(1);
    expect(h.failed).toEqual([]);
    expectValidReport(report);
  });

  it("AC-5: with team/tests-ok configured, a pull request carrying only pharn/accepted asks nothing and keeps its blocks", async () => {
    const { report, eventCalls, h, comment } = await signoffRun({
      diff: acceptFixture("block.diff"),
      inputs: { "test-integrity": "block", "accept-label": CUSTOM },
      labels: [{ name: LABEL, color: "0e8a16" }],
      events: humanEventsFor(LABEL),
    });

    expect(eventCalls).toEqual([]);
    expect(severities(report)).toEqual(["TI10 block", "TI13 block"]);
    expect(report.testIntegrity.accepted ?? null).toBeNull();
    expect(report.testIntegrity.acceptLabel).toBe(CUSTOM);
    expect(codes(report, "TEST_INTEGRITY_ACCEPTED")).toEqual([]);
    expect(codes(report, "TEST_INTEGRITY_ACCEPT_IGNORED")).toEqual([]);
    expect(h.failed).toHaveLength(1);

    // The TI10 and TI13 hints in the posted comment name the configured label, not the default one.
    for (const id of ["TI10", "TI13"]) {
      for (const hint of hintsOf(comment, id)) {
        expect(hint, id).toContain(`\`${CUSTOM}\``);
        expect(hint, id).not.toContain(LABEL);
      }
    }
    expectValidReport(report);
  });

  it("AC-5: PHARN/Accepted on the pull request and Pharn/accepted in the newest event match the default label", async () => {
    const { report, eventCalls, h } = await signoffRun({
      diff: acceptFixture("block.diff"),
      inputs: { "test-integrity": "block" },
      labels: [{ name: "PHARN/Accepted", color: "0e8a16" }],
      events: humanEventsFor("Pharn/accepted"),
    });

    expect(eventCalls.length).toBeGreaterThan(0);
    expect(report.testIntegrity.accepted).toEqual({ label: LABEL, by: "Reviewer-1" });
    expect("acceptLabel" in report.testIntegrity).toBe(false);
    expect(severities(report)).toEqual(["TI10 warn", "TI13 warn"]);
    expect(h.failed).toEqual([]);
    expectValidReport(report);
  });

  it("AC-5: an accepted run whose diff coverage is below the threshold still fails on the coverage", async () => {
    const { report, h } = await signoffRun({
      diff: acceptFixture("block.diff"),
      inputs: { "test-integrity": "block", threshold: "80" },
      events: humanEventsFor(LABEL),
      coverage: UNCOVERED,
    });

    expect(codes(report, "DIFF_COVERAGE_BELOW_THRESHOLD").map((m) => m.level)).toEqual(["error"]);
    expect(report.verdict).toBe("fail");
    expect(h.failed).toHaveLength(1);
    expect(severities(report)).toEqual(["TI10 warn", "TI13 warn"]);
    expect(report.testIntegrity.accepted?.by).toBe("Reviewer-1");
    expectValidReport(report);
  });
});
