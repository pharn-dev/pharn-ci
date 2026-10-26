import { describe, expect, it } from "vitest";

// detectAgentPr is loaded inside each test body: the AC tests are written before the build adds it, so nothing the
// build adds may run while this file loads. The pull request's author is held human; only the commits vary.

type Commit = { authorLogin: string | null; committerLogin: string | null; message: string };
type Facts = {
  pr: {
    author: { login: string; type: string } | null;
    labels: string[];
    commits: Commit[] | null;
    commitsIncomplete?: boolean;
  } | null;
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

const HUMAN_AUTHOR = { login: "octocat", type: "User" };
const human = (message: string): Commit => ({ authorLogin: "octocat", committerLogin: "octocat", message });

const withCommits = (commits: Commit[], extra: Partial<Facts> = {}): Facts => ({
  pr: { author: HUMAN_AUTHOR, labels: [], commits },
  ...extra,
});

const CLAUDE_TRAILER = "Add retry to the upload step\n\nCo-authored-by: Claude <noreply@anthropic.com>\n";
const CURSOR_TRAILER = "Fix the flaky timer test\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>\n";

// The first test of a file loads core's index cold, which can take seconds on a loaded host.
describe("agent-pr-detection: the pull request's commits", { timeout: 60_000 }, () => {
  it("AC-4: a github-actions[bot] commit author gives commit-bot", async () => {
    const { detectAgentPr } = await load();
    const detection = detectAgentPr(
      withCommits([
        { authorLogin: "github-actions[bot]", committerLogin: "octocat", message: "Regenerate the lockfile\n" },
        human("Fix the parser\n"),
      ]),
    );
    expect(detection.isAgentPr).toBe(true);
    expect(detection.evidence).toEqual(["commit-bot"]);
    expect(detection.agentHint).toBeNull();
  });

  it("AC-4: a devin-ai-integration[bot] committer gives commit-bot and commit-known-agent with hint devin", async () => {
    const { detectAgentPr } = await load();
    const detection = detectAgentPr(
      withCommits([
        { authorLogin: "octocat", committerLogin: "devin-ai-integration[bot]", message: "Bump the parser\n" },
      ]),
    );
    expect(detection.isAgentPr).toBe(true);
    expect(detection.evidence).toEqual(["commit-bot", "commit-known-agent"]);
    expect(detection.agentHint).toBe("devin");
  });

  it("AC-4: an agent trailer only in the first of three commits, with a human last commit, gives an agent PR with hint claude-code", async () => {
    const { detectAgentPr } = await load();
    const detection = detectAgentPr(
      withCommits([human(CLAUDE_TRAILER), human("Address review comments\n"), human("Fix the lint warning\n")]),
    );
    expect(detection.isAgentPr).toBe(true);
    expect(detection.evidence).toEqual(["co-author-known-agent"]);
    expect(detection.agentHint).toBe("claude-code");
  });

  it("AC-4: a Devin noreply trailer and a Copilot noreply trailer each give co-author-known-agent through the known logins", async () => {
    const { detectAgentPr } = await load();
    const devin = detectAgentPr(
      withCommits([
        human(
          "Bump the parser\n\nCo-authored-by: devin-ai-integration[bot] <158243242+devin-ai-integration[bot]@users.noreply.github.com>\n",
        ),
      ]),
    );
    expect(devin.isAgentPr).toBe(true);
    expect(devin.evidence).toEqual(["co-author-known-agent"]);
    expect(devin.agentHint).toBe("devin");

    const copilot = detectAgentPr(
      withCommits([human("Fix the docs\n\nCo-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>\n")]),
    );
    expect(copilot.isAgentPr).toBe(true);
    expect(copilot.evidence).toEqual(["co-author-known-agent"]);
    expect(copilot.agentHint).toBe("copilot");
  });

  it("AC-4: a noreply trailer of an extraLogins login gives co-author-extra-login", async () => {
    const { detectAgentPr } = await load();
    const detection = detectAgentPr(
      withCommits([human("Refresh the data\n\nCo-authored-by: Acme <12345+Acme-Agent@users.noreply.github.com>\n")], {
        extraLogins: ["acme-agent"],
      }),
    );
    expect(detection.isAgentPr).toBe(true);
    expect(detection.evidence).toEqual(["co-author-extra-login"]);
    expect(detection.agentHint).toBeNull();
  });

  it("AC-4: Claude and Cursor evidence together give hint claude-code", async () => {
    const { detectAgentPr } = await load();
    const detection = detectAgentPr(withCommits([human(CURSOR_TRAILER), human(CLAUDE_TRAILER)]));
    expect(detection.isAgentPr).toBe(true);
    expect(detection.evidence).toEqual(["co-author-known-agent"]);
    expect(detection.agentHint).toBe("claude-code");
  });
});
