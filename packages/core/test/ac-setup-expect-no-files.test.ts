import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside the test body: the AC tests are written before setup.expect and
// fixtures/setup-expect/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

const lines = (path: string) => fixture(path).trim().split("\n");

type Message = { level: string; code: string; text: string };
type Report = { verdict: string; agentSetup: { missing?: unknown }; messages: Message[] };

type Path = "normal" | "coverage missing" | "diff unavailable";

async function runCheck(path: Path, requireAgentSetup: boolean): Promise<Report> {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage:
      path === "coverage missing"
        ? { missingFile: "coverage/lcov.info" }
        : { text: fixture("golden/coverage.info"), format: "lcov", file: "coverage/lcov.info" },
    diff:
      path === "diff unavailable"
        ? { unavailable: "could not get the diff for base...head" }
        : { text: fixture("golden/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: lines("setup-expect/no-setup.txt"),
    requireAgentSetup,
    expectAgentSetup: ["cursor", "claude-code"],
  };
  return check(input as Parameters<typeof check>[0]) as unknown as Report;
}

const SETUP_CODES = new Set(["NO_AGENT_SETUP_FILES", "AGENT_SETUP_EXPECTED_MISSING"]);

describe("check(): expected agent tools with no agent setup files", () => {
  it("AC-4: every report path names both tools after NO_AGENT_SETUP_FILES, at warn, or at error with a fail verdict when setup is required", async () => {
    for (const path of ["normal", "coverage missing", "diff unavailable"] as const) {
      for (const requireAgentSetup of [false, true]) {
        const label = `${path}, requirement ${requireAgentSetup ? "on" : "off"}`;
        const report = await runCheck(path, requireAgentSetup);
        expectValidReport(report);
        expect(report.agentSetup.missing, label).toEqual(["claude-code", "cursor"]);

        // NO_AGENT_SETUP_FILES comes first, then the one AGENT_SETUP_EXPECTED_MISSING message.
        const setupMessages = report.messages.filter((message) => SETUP_CODES.has(message.code));
        expect(
          setupMessages.map((message) => message.code),
          label,
        ).toEqual(["NO_AGENT_SETUP_FILES", "AGENT_SETUP_EXPECTED_MISSING"]);
        const expected = setupMessages[1] as Message;
        expect(expected.text, label).toBe("No agent setup file configures the expected tools: claude-code, cursor.");
        expect(expected.level, label).toBe(requireAgentSetup ? "error" : "warn");
        if (requireAgentSetup) expect(report.verdict, label).toBe("fail");
      }
    }
  });
});
