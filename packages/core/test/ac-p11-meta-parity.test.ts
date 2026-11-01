import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-14. check(), detectAgentPr() and withAgentPrMeta() are loaded inside the test body: the
// AC test is written before check() takes agentPrFacts, so nothing the build adds may run while this file loads.
// fixtures/agent-pr/ is part A's and is only read.

type Commit = { authorLogin: string | null; committerLogin: string | null; message: string };
type Facts = { pr: { author: { login: string; type: string } | null; labels: string[]; commits: Commit[] | null } };
type Detection = { isAgentPr: boolean };
type Message = { level: string; code: string; text: string };
type Report = Record<string, unknown> & { messages: Message[]; meta?: Record<string, unknown> };

interface Core {
  check(input: unknown): Report;
  detectAgentPr(facts: Facts): Detection;
  withAgentPrMeta(report: Report, detection: Detection, facts: Facts): Report;
}

const AGENT_PR_DIR = new URL("../../../fixtures/agent-pr/", import.meta.url);
const META = {
  event: "pull_request",
  repository: "pharn-dev/pharn-ci",
  repositoryId: 123,
  prNumber: 68,
  headSha: "b".repeat(40),
  baseSha: "a".repeat(40),
  scope: "ci/check",
  runId: 9,
  runAttempt: 1,
  actor: "octocat",
  upload: { status: "skipped" },
};

describe("check() with agent facts: the same meta as withAgentPrMeta", { timeout: 60_000 }, () => {
  it("AC-14: for every part A agent-pr fixture, check() with agentPrFacts and no policy serializes byte for byte like withAgentPrMeta over the report without facts, with no policy section and no new message", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const names = readdirSync(AGENT_PR_DIR)
      .filter((n) => n.endsWith(".txt"))
      .sort();
    expect(names.length).toBeGreaterThanOrEqual(5);

    const input = {
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
      meta: META,
    };
    const without = core.check(input);
    expectValidReport(without);

    let agents = 0;
    for (const name of names) {
      const message = readFileSync(new URL(name, AGENT_PR_DIR), "utf8");
      for (const author of [
        { login: "octocat", type: "User" },
        { login: "claude[bot]", type: "Bot" },
      ]) {
        const facts: Facts = {
          pr: { author, labels: [], commits: [{ authorLogin: author.login, committerLogin: author.login, message }] },
        };
        const label = `${name} by ${author.login}`;
        const detection = core.detectAgentPr(facts);
        if (detection.isAgentPr) agents++;
        const expected = core.withAgentPrMeta(structuredClone(without), detection, facts);
        const actual = core.check({ ...input, agentPrFacts: facts });
        expectValidReport(actual);
        expect(JSON.stringify(actual), label).toBe(JSON.stringify(expected));
        expect(Object.hasOwn(actual, "policy"), label).toBe(false);
        expect(actual.messages, label).toEqual(without.messages);
        expect(actual.meta?.isAgentPr, label).toBe(detection.isAgentPr);
      }
    }
    expect(agents, "some fixtures give agent PRs").toBeGreaterThan(0);
  });
});
