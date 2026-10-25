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
const AUTHOR = { login: "octo-author", type: "User" };
/** Every login the cases put in front of the Action; none may reach a message. */
const LOGINS = ["octo-author", "claude[bot]", "octo-org", "Reviewer-1"];

type Page = { events: unknown; hasNext: boolean };
type Message = { level: string; code: string; text: string };

/** One pull_request Action run (PR #7) in mode block on the block diff, against the fake API. */
async function signoffRun(events: unknown) {
  const { run } = await import("../src/run.js");
  const diff = acceptFixture("block.diff");
  const h = harness({
    inputs: { "test-integrity": "block" },
    lsFiles: acceptFixture("files.txt").trim().split("\n"),
    context: PR_CONTEXT,
  });
  const eventCalls: Array<[number, number]> = [];
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
    async listIssueEvents(issueNumber: number, page: number): Promise<Page> {
      eventCalls.push([issueNumber, page]);
      if (!Array.isArray(events)) return { events, hasNext: false };
      return { events: events.slice((page - 1) * 100, page * 100), hasNext: events.length > page * 100 };
    },
  } as typeof h.deps.api;
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  const report = text === undefined ? undefined : JSON.parse(text);
  return { h, report, eventCalls };
}

const codes = (report: { messages: Message[] }, code: string) => report.messages.filter((m) => m.code === code);

describe("the newest labeling event made by the PR author or by an account that is not a user", () => {
  const cases = [
    ["events-author.json", "the PR author (OCTO-Author, another case of octo-author)", /author/i],
    ["events-bot.json", "a Bot account", /user account/i],
    ["events-organization.json", "an Organization account", /user account/i],
  ] as const;

  for (const [file, who, says] of cases) {
    it(`AC-6: a label applied by ${who} is ignored, the blocks stay and the step fails`, async () => {
      const { h, report, eventCalls } = await signoffRun(JSON.parse(acceptFixture(file)));

      expect(eventCalls.length).toBeGreaterThan(0);
      expect(
        report.testIntegrity.signals.map((s: { id: string; severity: string }) => `${s.id} ${s.severity}`),
      ).toEqual(["TI10 block", "TI13 block"]);
      expect(report.testIntegrity.verdict).toBe("fail");
      expect(report.verdict).toBe("fail");
      expect(h.failed).toHaveLength(1);
      expect(report.testIntegrity.accepted ?? null).toBeNull();
      expect(codes(report, "TEST_INTEGRITY_ACCEPTED")).toEqual([]);

      const ignored = codes(report, "TEST_INTEGRITY_ACCEPT_IGNORED");
      expect(ignored).toHaveLength(1);
      expect(ignored[0]?.level).toBe("warn");
      expect(ignored[0]?.text).toContain(LABEL);
      expect(ignored[0]?.text).toMatch(says);
      for (const login of LOGINS) expect(ignored[0]?.text.toLowerCase()).not.toContain(login.toLowerCase());
      expectValidReport(report);
    });
  }
});
