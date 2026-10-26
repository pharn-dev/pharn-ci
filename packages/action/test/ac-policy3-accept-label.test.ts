import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// run() and the fixtures under fixtures/policy-api/ and fixtures/accept-label/ are loaded inside the test body: the
// AC test is written before the org policy exists, so nothing the build adds may run while the file loads. The run
// uses a real temporary workspace (the file: policy reader lstats each path segment) and the fake GitHub API of the
// accept-label tests: the PR author is a bot, the PR carries the label org/ok, and its issue events show that label
// applied by a user who is not the author, so today's accept-label rules honour org/ok when the step looks for it.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const acceptFixture = (name: string) => read(`fixtures/accept-label/${name}`);

const APP_LABEL = "org/ok";
const INPUT_LABEL = "team/ok";
const GOLDEN_ROOT = "/home/runner/work/demo/demo";
const NOW = new Date("2026-10-26T12:00:00.000Z");

type Signal = { id: string; severity: string };
type Message = { level: string; code: string; text: string };
type Report = {
  verdict: string;
  messages: Message[];
  testIntegrity: { signals: Signal[]; accepted?: { label: string; by: string | null } | null; acceptLabel?: string };
};

async function realReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

const EVENTS = [
  {
    id: 2001,
    event: "labeled",
    actor: { login: "Reviewer-1", type: "User" },
    label: { name: APP_LABEL, color: "0e8a16" },
    created_at: "2026-10-20T10:00:00Z",
  },
];

async function labelRun(dir: string, policy: string, envelope?: string) {
  const { run } = await import("../src/run.js");
  const diff = acceptFixture("block.diff");
  const context = { ...PR_CONTEXT, payload: { ...PR_CONTEXT.payload, repository: { full_name: "acme/widgets" } } };
  const h = harness({
    inputs: { policy, "test-integrity": "block", "accept-label": INPUT_LABEL },
    lsFiles: acceptFixture("files.txt").trim().split("\n"),
    context: context as never,
  });
  const git = h.deps.git;
  h.deps.git = async (args) => (args[0] === "diff" ? diff : git(args));
  h.deps.api = {
    ...h.deps.api,
    async compareDiff() {
      return diff;
    },
    async getPullRequestSignoff() {
      return { author: { login: "claude[bot]", type: "Bot" }, labels: [{ name: APP_LABEL, color: "0e8a16" }] };
    },
    async listIssueEvents(_issue: number, page: number) {
      return { events: page === 1 ? EVENTS : [], hasNext: false };
    },
  } as typeof h.deps.api;
  const calls: string[] = [];
  Object.assign(h.deps, {
    workspace: dir,
    readFile: realReadFile,
    fetch: async (input: unknown) => {
      calls.push(String(input instanceof Request ? input.url : input));
      if (envelope === undefined) throw new Error("no fetch was expected");
      return new Response(envelope, { status: 200, headers: { "content-type": "application/json" } });
    },
    getIDToken: async () => "tok-SECRET-123",
    setSecret: () => {},
    hasOidcEnv: true,
    now: () => NOW,
    sleep: async () => {},
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`${policy}: no report was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, report, calls };
}

const blocks = (report: Report) => report.testIntegrity.signals.filter((s) => s.severity === "block");

describe("the accept label from an org policy", () => {
  it("AC-23: an app policy's accept_label replaces the accept-label input; a file policy's is never read and is recorded", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-policy3-label-")));
    try {
      mkdirSync(join(dir, "coverage"), { recursive: true });
      writeFileSync(
        join(dir, "coverage/lcov.info"),
        read("fixtures/golden/coverage.info").replaceAll(GOLDEN_ROOT, dir),
      );
      const document = { version: 1, test_integrity: { accept_label: APP_LABEL } };
      mkdirSync(join(dir, "policy"), { recursive: true });
      writeFileSync(join(dir, "policy/org.json"), JSON.stringify(document));
      const envelope = { ...JSON.parse(read("fixtures/policy-api/envelope-valid.json")), policy: document };

      // Control: with no policy the step looks for team/ok, which the PR does not carry, and the blocks stay.
      const never = await labelRun(dir, "never");
      expect(blocks(never.report).length).toBeGreaterThan(0);
      expect(never.report.testIntegrity.accepted ?? null).toBeNull();

      const appRun = await labelRun(dir, "auto", JSON.stringify(envelope));
      expect(appRun.calls).toHaveLength(1);
      expect(appRun.report.testIntegrity.accepted).toEqual({ label: APP_LABEL, by: "Reviewer-1" });
      expect(blocks(appRun.report)).toEqual([]);
      expect(appRun.report.testIntegrity.signals.map((s) => s.id)).toEqual(
        never.report.testIntegrity.signals.map((s) => s.id),
      );
      expect(appRun.report.messages.filter((m) => m.code === "POLICY_OVERRIDE_IGNORED")).toEqual([]);

      const fileRun = await labelRun(dir, "file:policy/org.json");
      expect(fileRun.calls).toEqual([]);
      expect(fileRun.report.testIntegrity.accepted ?? null).toBeNull();
      expect(fileRun.report.testIntegrity.acceptLabel).toBe(INPUT_LABEL);
      expect(blocks(fileRun.report)).toEqual(blocks(never.report));
      const ignored = fileRun.report.messages.filter((m) => m.code === "POLICY_OVERRIDE_IGNORED");
      expect(ignored).toHaveLength(1);
      expect(ignored[0]?.text).toContain("test_integrity.accept_label (policy-file)");
      expect(ignored[0]?.text).not.toContain(APP_LABEL);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
