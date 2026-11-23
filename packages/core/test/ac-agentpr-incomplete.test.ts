import { describe, expect, it } from "vitest";
import type { AgentPrFacts } from "../src/agents.js";

// detectAgentPr is loaded inside each test body: the AC tests are written before the build adds it, so nothing the
// build adds may run while this file loads.

type Commit = NonNullable<NonNullable<AgentPrFacts["pr"]>["commits"]>[number];

const load = async () => await import("../src/index.js");

const HUMAN_AUTHOR = { login: "octocat", type: "User" } as const;
const HUMAN_COMMITS: Commit[] = [{ authorLogin: "octocat", committerLogin: "octocat", message: "Fix the parser\n" }];

// The first test of a file loads core's index cold, which can take seconds on a loaded host.
describe("agent-pr-detection: facts that cannot be read in full fail closed", { timeout: 60_000 }, () => {
  it("AC-6: pr null is not an agent PR and carries nothing", async () => {
    const { detectAgentPr } = await load();
    expect(detectAgentPr({ pr: null })).toEqual({
      isAgentPr: false,
      agentHint: null,
      evidence: [],
      incomplete: null,
      coAuthors: [],
    });
  });

  it("AC-6: author null gives an agent PR with incomplete author-unknown", async () => {
    const { detectAgentPr } = await load();
    const detection = detectAgentPr({ pr: { author: null, labels: [], commits: HUMAN_COMMITS } });
    expect(detection.isAgentPr).toBe(true);
    expect(detection.incomplete).toBe("author-unknown");
    expect(detection.evidence).toEqual([]);
  });

  it("AC-6: commits null gives an agent PR with incomplete commits-unreadable", async () => {
    const { detectAgentPr } = await load();
    const detection = detectAgentPr({ pr: { author: HUMAN_AUTHOR, labels: [], commits: null } });
    expect(detection.isAgentPr).toBe(true);
    expect(detection.incomplete).toBe("commits-unreadable");
    expect(detection.evidence).toEqual([]);
  });

  it("AC-6: commitsIncomplete true gives an agent PR with incomplete commits-truncated", async () => {
    const { detectAgentPr } = await load();
    const detection = detectAgentPr({
      pr: { author: HUMAN_AUTHOR, labels: [], commits: HUMAN_COMMITS, commitsIncomplete: true },
    });
    expect(detection.isAgentPr).toBe(true);
    expect(detection.incomplete).toBe("commits-truncated");
    expect(detection.evidence).toEqual([]);
  });

  it("AC-6: author and commits both missing give incomplete author-unknown", async () => {
    const { detectAgentPr } = await load();
    const detection = detectAgentPr({ pr: { author: null, labels: [], commits: null } });
    expect(detection.isAgentPr).toBe(true);
    expect(detection.incomplete).toBe("author-unknown");
  });
});
