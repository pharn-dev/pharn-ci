import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside the test body: the AC tests are written before setup.expect and
// fixtures/setup-expect/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

const lines = (path: string) => fixture(path).trim().split("\n");

type Message = { level: string; code: string; text: string };
type Report = { agentSetup: Record<string, unknown> & { missing?: unknown }; messages: Message[] };

async function runCheck(repoFiles: string[], expectAgentSetup?: string[]): Promise<Report> {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov", file: "coverage/lcov.info" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles,
    ...(expectAgentSetup === undefined ? {} : { expectAgentSetup }),
  };
  return check(input as Parameters<typeof check>[0]) as unknown as Report;
}

const expectedMissing = (report: Report) =>
  report.messages.filter((message) => message.code === "AGENT_SETUP_EXPECTED_MISSING");

describe("check(): expected agent tools with AGENTS.md only", () => {
  it("AC-3: names the expected tools AGENTS.md does not configure, sorted and once, with one warn message; nothing expected adds nothing", async () => {
    const files = lines("setup-expect/agents-md-only.txt");

    // AGENTS.md configures cursor and codex, not claude-code; the duplicate claude-code is named once.
    const oneMissing = await runCheck(files, ["cursor", "claude-code", "codex", "claude-code"]);
    expectValidReport(oneMissing);
    expect(oneMissing.agentSetup.missing).toEqual(["claude-code"]);
    expect(expectedMissing(oneMissing).map(({ level, text }) => ({ level, text }))).toEqual([
      { level: "warn", text: "No agent setup file configures the expected tool: claude-code." },
    ]);

    // Every expected tool is configured: an empty list, and no message.
    const allPresent = await runCheck(files, ["cursor", "codex"]);
    expectValidReport(allPresent);
    expect(allPresent.agentSetup.missing).toEqual([]);
    expect(expectedMissing(allPresent)).toEqual([]);

    // Nothing expected (not given, or an empty list): no field and no message, so the report is today's.
    const notGiven = await runCheck(files);
    const emptyList = await runCheck(files, []);
    for (const [label, report] of [
      ["not given", notGiven],
      ["empty list", emptyList],
    ] as const) {
      expectValidReport(report);
      expect(Object.hasOwn(report.agentSetup, "missing"), label).toBe(false);
      expect(expectedMissing(report), label).toEqual([]);
    }
    expect(emptyList).toEqual(notGiven);
  });
});
