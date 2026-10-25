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
const LONG_LOGIN = "r".repeat(40);

type Page = { events: unknown; hasNext: boolean };
type Event = { event: string; actor: unknown; label?: { name: string } };
type Message = { level: string; code: string; text: string };

interface SignoffOptions {
  events?: unknown;
  page?: (page: number) => Promise<Page>;
  signoffError?: Error;
}

/** One pull_request Action run (PR #7) in mode block on the block diff, against the fake API. */
async function signoffRun(options: SignoffOptions) {
  const { run } = await import("../src/run.js");
  const diff = acceptFixture("block.diff");
  const h = harness({
    inputs: { "test-integrity": "block" },
    lsFiles: acceptFixture("files.txt").trim().split("\n"),
    context: PR_CONTEXT,
  });
  const signoffCalls: number[] = [];
  const eventCalls: Array<[number, number]> = [];
  const git = h.deps.git;
  h.deps.git = async (args) => (args[0] === "diff" ? diff : git(args));
  h.deps.api = {
    ...h.deps.api,
    async compareDiff(basehead: string) {
      h.apiCalls.push(`compare ${basehead}`);
      return diff;
    },
    async getPullRequestSignoff(pullNumber: number) {
      signoffCalls.push(pullNumber);
      if (options.signoffError) throw options.signoffError;
      return { author: BOT_AUTHOR, labels: [{ name: LABEL, color: "0e8a16" }] };
    },
    async listIssueEvents(issueNumber: number, page: number): Promise<Page> {
      eventCalls.push([issueNumber, page]);
      if (options.page) return options.page(page);
      const all = options.events ?? [];
      if (!Array.isArray(all)) return { events: all, hasNext: false };
      return { events: all.slice((page - 1) * 100, page * 100), hasNext: all.length > page * 100 };
    },
  } as typeof h.deps.api;
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  const report = text === undefined ? undefined : JSON.parse(text);
  return { h, report, text: text ?? "", signoffCalls, eventCalls };
}

/** events-human.json with the actor of the newest `pharn/accepted` labeling event replaced. */
function humanEventsWithActor(actor: unknown): Event[] {
  const events = JSON.parse(acceptFixture("events-human.json")) as Event[];
  const at = events.findLastIndex((e) => e.event === "labeled" && e.label?.name === LABEL);
  if (at === -1) throw new Error("events-human.json has no labeling event for pharn/accepted");
  return events.map((e, i) => (i === at ? { ...e, actor } : e));
}

/** A full page of 100 events: page 1 starts with events-human.json, the rest are labeling events for other labels. */
function fullPage(page: number): Event[] {
  const head = page === 1 ? (JSON.parse(acceptFixture("events-human.json")) as Event[]) : [];
  const filler = Array.from({ length: 100 - head.length }, (_, i) => ({
    id: page * 1000 + i,
    event: "labeled",
    actor: { login: "Filler-Bot-Login", type: "User" },
    label: { name: `filler-label-${page}-${i}`, color: "ededed" },
    created_at: "2026-10-01T00:00:00Z",
  }));
  return [...head, ...filler];
}

const codes = (report: { messages: Message[] }, code: string) => report.messages.filter((m) => m.code === code);

const NOT_FOUND = /no label(l)?ing event/i;
const NOT_READ = /could not be read/i;

describe("anything the Action cannot read about who applied the label fails closed", () => {
  const forbidden = [
    "secret-403",
    "secret-timeout",
    "not a list",
    "a<b>c",
    "a&lt;b",
    LONG_LOGIN,
    "Filler-Bot",
    "filler-label",
  ];

  const cases: Array<[string, () => SignoffOptions, RegExp]> = [
    [
      "no labeling event for the label, only other labels and an unlabeled event",
      () => ({ events: JSON.parse(acceptFixture("events-no-matching-event.json")) }),
      NOT_FOUND,
    ],
    [
      "the events request rejects with HTTP 403",
      () => ({
        page: async () => {
          throw Object.assign(new Error("Resource not accessible by integration <secret-403>"), { status: 403 });
        },
      }),
      NOT_READ,
    ],
    [
      "the events request times out",
      () => ({
        page: async () => {
          throw Object.assign(new Error("Request timed out <secret-timeout>"), { name: "TimeoutError" });
        },
      }),
      NOT_READ,
    ],
    [
      "the events response is not a list",
      () => ({ events: JSON.parse(acceptFixture("events-unreadable.json")) }),
      NOT_READ,
    ],
    [
      "the newest labeling event has no actor (a deleted account)",
      () => ({ events: JSON.parse(acceptFixture("events-no-actor.json")) }),
      NOT_READ,
    ],
    [
      "the newest labeling event's actor is a User with the login a<b>c",
      () => ({ events: JSON.parse(acceptFixture("events-hostile-login.json")) }),
      NOT_READ,
    ],
    [
      "the newest labeling event's actor is a User with a 40-character login",
      () => ({ events: humanEventsWithActor({ login: LONG_LOGIN, type: "User" }) }),
      NOT_READ,
    ],
    [
      "the event list is longer than 1,000 events",
      () => ({ page: async (page: number) => ({ events: fullPage(page), hasNext: true }) }),
      NOT_READ,
    ],
    [
      "reading the pull request itself fails",
      () => ({ signoffError: new Error("Server Error <secret-403> not a list") }),
      NOT_READ,
    ],
  ];

  for (const [name, options, says] of cases) {
    it(`AC-7: ${name}: the blocks stay, the step fails and the message names only the label`, async () => {
      const { h, report, text, signoffCalls, eventCalls } = await signoffRun(options());

      expect(signoffCalls).toEqual([7]);
      expect(
        report.testIntegrity.signals.map((s: { id: string; severity: string }) => `${s.id} ${s.severity}`),
      ).toEqual(["TI10 block", "TI13 block"]);
      expect(report.verdict).toBe("fail");
      expect(report.testIntegrity.verdict).toBe("fail");
      expect(h.failed).toHaveLength(1);
      expect(report.testIntegrity.accepted ?? null).toBeNull();
      expect(codes(report, "TEST_INTEGRITY_ACCEPTED")).toEqual([]);

      const ignored = codes(report, "TEST_INTEGRITY_ACCEPT_IGNORED");
      expect(ignored).toHaveLength(1);
      expect(ignored[0]?.level).toBe("warn");
      expect(ignored[0]?.text).toContain(LABEL);
      expect(ignored[0]?.text).toMatch(says);

      // At most 10 event pages; none at all when the pull request itself could not be read.
      expect(eventCalls.length).toBeLessThanOrEqual(10);
      if (name.startsWith("reading the pull request")) expect(eventCalls).toEqual([]);
      else expect(eventCalls.length).toBeGreaterThan(0);

      // No message, comment, report or failure text holds the error text or anything else the API returned.
      const surfaces = [text, ...h.posted, ...h.failed, ...report.messages.map((m: Message) => m.text)];
      for (const surface of surfaces) {
        for (const bit of forbidden) expect(surface, bit).not.toContain(bit);
        expect(surface).not.toMatch(/@?claude\[bot\]|Reviewer-1|octo-author/i);
      }
      expectValidReport(report);
    });
  }
});
