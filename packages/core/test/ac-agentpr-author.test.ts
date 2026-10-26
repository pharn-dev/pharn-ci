import { describe, expect, it } from "vitest";

// detectAgentPr is loaded inside each test body: the AC tests are written before the build adds it, so nothing the
// build adds may run while this file loads. The commits are held human; only the pull request's author varies.

type Author = { login: string; type: string } | null;
type Commit = { authorLogin: string | null; committerLogin: string | null; message: string };
type Facts = {
  pr: { author: Author; labels: string[]; commits: Commit[] | null; commitsIncomplete?: boolean } | null;
  labels?: string[];
  extraLogins?: string[];
};
type Detection = {
  isAgentPr: boolean;
  agentHint: string | null;
  evidence: string[];
  incomplete: string | null;
  coAuthors: string[];
};

interface DetectModule {
  detectAgentPr(facts: Facts): Detection;
}

const load = async () => (await import("../src/index.js")) as unknown as DetectModule;

const HUMAN_COMMITS: Commit[] = [
  { authorLogin: "octocat", committerLogin: "octocat", message: "Fix the parser\n" },
  { authorLogin: "octocat", committerLogin: "octocat", message: "Update the README wording\n" },
];

const withAuthor = (author: Author, extra: Partial<Facts> = {}): Facts => ({
  pr: { author, labels: [], commits: HUMAN_COMMITS },
  ...extra,
});

// The first test of a file loads core's index cold, which can take seconds on a loaded host.
describe("agent-pr-detection: the pull request's author", { timeout: 60_000 }, () => {
  it("AC-3: a Bot type or a login ending in [bot] gives author-bot", async () => {
    const { detectAgentPr } = await load();
    for (const author of [
      { login: "some-app", type: "Bot" },
      { login: "dependabot[bot]", type: "Bot" },
      { login: "renovate[bot]", type: "User" },
    ]) {
      const detection = detectAgentPr(withAuthor(author));
      expect(detection.isAgentPr, author.login).toBe(true);
      expect(detection.evidence, author.login).toEqual(["author-bot"]);
      expect(detection.agentHint, author.login).toBeNull();
    }
  });

  it("AC-3: author Copilot of type Bot gives author-bot and author-known-agent with hint copilot", async () => {
    const { detectAgentPr } = await load();
    const detection = detectAgentPr(withAuthor({ login: "Copilot", type: "Bot" }));
    expect(detection.isAgentPr).toBe(true);
    expect(detection.evidence).toEqual(["author-bot", "author-known-agent"]);
    expect(detection.agentHint).toBe("copilot");
  });

  it("AC-3: author cursoragent of type User gives author-known-agent with hint cursor", async () => {
    const { detectAgentPr } = await load();
    const detection = detectAgentPr(withAuthor({ login: "cursoragent", type: "User" }));
    expect(detection.isAgentPr).toBe(true);
    expect(detection.evidence).toEqual(["author-known-agent"]);
    expect(detection.agentHint).toBe("cursor");
  });

  it("AC-3: an author in extraLogins in a different letter case gives author-extra-login", async () => {
    const { detectAgentPr } = await load();
    const upperLogin = detectAgentPr(
      withAuthor({ login: "Acme-Agent", type: "User" }, { extraLogins: ["acme-agent"] }),
    );
    expect(upperLogin.isAgentPr).toBe(true);
    expect(upperLogin.evidence).toEqual(["author-extra-login"]);
    expect(upperLogin.agentHint).toBeNull();

    const upperList = detectAgentPr(withAuthor({ login: "acme-agent", type: "User" }, { extraLogins: ["ACME-AGENT"] }));
    expect(upperList.isAgentPr).toBe(true);
    expect(upperList.evidence).toEqual(["author-extra-login"]);
  });

  it("AC-3: a human author with human commits is not an agent PR", async () => {
    const { detectAgentPr } = await load();
    const detection = detectAgentPr(withAuthor({ login: "octocat", type: "User" }));
    expect(detection.isAgentPr).toBe(false);
    expect(detection.evidence).toEqual([]);
    expect(detection.agentHint).toBeNull();
    expect(detection.incomplete).toBeNull();
  });
});
