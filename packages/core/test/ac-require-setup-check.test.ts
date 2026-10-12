import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside the test body: the AC tests are written before the agent setup
// requirement and fixtures/require-agent-setup/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

const lines = (path: string) => fixture(path).trim().split("\n");

async function runCheck(repoFiles: string[], requireAgentSetup?: boolean) {
  const { check } = await import("../src/check.js");
  return check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov", file: "coverage/lcov.info" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles,
    ...(requireAgentSetup === undefined ? {} : { requireAgentSetup }),
  });
}

const setupMessages = (report: { messages: { code: string; level: string }[] }) =>
  report.messages
    .filter((message) => message.code === "NO_AGENT_SETUP_FILES")
    .map(({ code, level }) => ({ code, level }));

describe("check(): agent setup requirement", () => {
  it("AC-1: a repo with no agent setup files fails only when the requirement is on; setup files mean no message", async () => {
    const noSetup = lines("require-agent-setup/files.txt");

    // Off or not given: the message stays info and the verdict is today's (pass, with no threshold).
    const absent = await runCheck(noSetup);
    const off = await runCheck(noSetup, false);
    for (const [label, report] of [
      ["absent", absent],
      ["off", off],
    ] as const) {
      expectValidReport(report);
      expect(setupMessages(report), label).toEqual([{ code: "NO_AGENT_SETUP_FILES", level: "info" }]);
      expect(report.verdict, label).toBe("pass");
    }
    expect(off).toEqual(absent);

    // A repo that has agent setup files gets no NO_AGENT_SETUP_FILES message, whether the requirement is on or off.
    for (const requireAgentSetup of [true, false]) {
      for (const path of ["golden/files.txt", "setup/all-kinds.txt"]) {
        const label = `${path}, requirement ${requireAgentSetup}`;
        const withSetup = await runCheck(lines(path), requireAgentSetup);
        expectValidReport(withSetup);
        expect(setupMessages(withSetup), label).toEqual([]);
      }
    }

    // On: the same input yields the message at level error and the verdict fail.
    const on = await runCheck(noSetup, true);
    expectValidReport(on);
    expect(setupMessages(on)).toEqual([{ code: "NO_AGENT_SETUP_FILES", level: "error" }]);
    expect(on.verdict).toBe("fail");
  });
});
