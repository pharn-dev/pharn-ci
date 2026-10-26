import { describe, expect, it } from "vitest";

// The agents module is loaded inside each test body: the AC tests are written before the build adds it, so nothing
// the build adds may run while this file loads.

interface ListsModule {
  KNOWN_AGENTS: unknown;
  DEFAULT_AGENT_LABELS: unknown;
}

const load = async () => (await import("../src/index.js")) as unknown as ListsModule;

/** The seven verified known agents, in the SPEC's order. */
const EXPECTED_AGENTS = [
  { hint: "claude-code", logins: ["claude[bot]"], emails: ["noreply@anthropic.com"] },
  { hint: "copilot", logins: ["Copilot", "copilot-swe-agent[bot]"], emails: [] },
  { hint: "codex", logins: ["chatgpt-codex-connector[bot]"], emails: [] },
  { hint: "devin", logins: ["devin-ai-integration[bot]"], emails: [] },
  { hint: "cursor", logins: ["cursor[bot]", "cursoragent"], emails: ["cursoragent@cursor.com"] },
  { hint: "gemini", logins: ["gemini-code-assist[bot]"], emails: [] },
  { hint: "jules", logins: ["google-labs-jules[bot]"], emails: [] },
];

// The first test of a file loads core's index cold, which can take seconds on a loaded host.
describe("agent-pr-detection: the known agents and the default agent labels", { timeout: 60_000 }, () => {
  it("AC-1: KNOWN_AGENTS deep-equals exactly the seven verified agents, in order", async () => {
    const { KNOWN_AGENTS } = await load();
    expect(Array.isArray(KNOWN_AGENTS), "KNOWN_AGENTS is an array").toBe(true);
    expect(KNOWN_AGENTS).toEqual(EXPECTED_AGENTS);
  });

  it("AC-1: DEFAULT_AGENT_LABELS equals agent and ai-generated", async () => {
    const { DEFAULT_AGENT_LABELS } = await load();
    expect(DEFAULT_AGENT_LABELS).toEqual(["agent", "ai-generated"]);
  });
});
