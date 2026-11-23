import { describe, expect, it } from "vitest";
import type { AgentPrFacts as Facts } from "../src/agents.js";

// detectAgentPr is loaded inside each test body: the AC tests are written before the build adds it, so nothing the
// build adds may run while this file loads. The author and the commits are held human; only the labels vary.

const load = async () => await import("../src/index.js");

const withLabels = (prLabels: string[], extra: Partial<Facts> = {}): Facts => ({
  pr: {
    author: { login: "octocat", type: "User" },
    labels: prLabels,
    commits: [{ authorLogin: "octocat", committerLogin: "octocat", message: "Fix the parser\n" }],
  },
  ...extra,
});

// The first test of a file loads core's index cold, which can take seconds on a loaded host.
describe("agent-pr-detection: the pull request's labels", { timeout: 60_000 }, () => {
  it("AC-5: the label AI-Generated counts with no lists given", async () => {
    const { detectAgentPr } = await load();
    const detection = detectAgentPr(withLabels(["AI-Generated"]));
    expect(detection.isAgentPr).toBe(true);
    expect(detection.evidence).toEqual(["label"]);
    expect(detection.agentHint).toBeNull();
  });

  it("AC-5: with labels [bot-pr] both Bot-PR and agent count", async () => {
    const { detectAgentPr } = await load();
    const custom = detectAgentPr(withLabels(["Bot-PR"], { labels: ["bot-pr"] }));
    expect(custom.isAgentPr).toBe(true);
    expect(custom.evidence).toEqual(["label"]);

    const defaultKept = detectAgentPr(withLabels(["agent"], { labels: ["bot-pr"] }));
    expect(defaultKept.isAgentPr).toBe(true);
    expect(defaultKept.evidence).toEqual(["label"]);
  });

  it("AC-5: the labels agents and not-agent give no label evidence", async () => {
    const { detectAgentPr } = await load();
    const detection = detectAgentPr(withLabels(["agents", "not-agent"]));
    expect(detection.evidence).not.toContain("label");
    expect(detection.evidence).toEqual([]);
    expect(detection.isAgentPr).toBe(false);
  });
});
