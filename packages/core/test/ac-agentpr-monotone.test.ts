import { describe, expect, it } from "vitest";

// detectAgentPr is loaded inside each test body: the AC tests are written before the build adds it, so nothing the
// build adds may run while this file loads. Each agent case of AC-3 to AC-6 is run again with human evidence added;
// the governing rule is that evidence the PR controls can only add the agent flag, never remove it.

type Commit = { authorLogin: string | null; committerLogin: string | null; message: string };
type Facts = {
  pr: {
    author: { login: string; type: string } | null;
    labels: string[];
    commits: Commit[] | null;
    commitsIncomplete?: boolean;
  };
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
const HUMAN_COMMITS: Commit[] = [human("Fix the parser\n")];

const pr = (overrides: Partial<Facts["pr"]>, extra: Partial<Omit<Facts, "pr">> = {}): Facts => ({
  pr: { author: HUMAN_AUTHOR, labels: [], commits: HUMAN_COMMITS, ...overrides },
  ...extra,
});

/** The agent cases of AC-3 to AC-6. */
const AGENT_CASES: { name: string; facts: Facts }[] = [
  { name: "a Bot-type author", facts: pr({ author: { login: "some-app", type: "Bot" } }) },
  { name: "a [bot] author login", facts: pr({ author: { login: "renovate[bot]", type: "User" } }) },
  { name: "author Copilot", facts: pr({ author: { login: "Copilot", type: "Bot" } }) },
  { name: "author cursoragent", facts: pr({ author: { login: "cursoragent", type: "User" } }) },
  {
    name: "an extraLogins author",
    facts: pr({ author: { login: "Acme-Agent", type: "User" } }, { extraLogins: ["acme-agent"] }),
  },
  {
    name: "a github-actions[bot] commit author",
    facts: pr({
      commits: [{ authorLogin: "github-actions[bot]", committerLogin: "octocat", message: "Regenerate\n" }],
    }),
  },
  {
    name: "a devin-ai-integration[bot] committer",
    facts: pr({
      commits: [{ authorLogin: "octocat", committerLogin: "devin-ai-integration[bot]", message: "Bump\n" }],
    }),
  },
  {
    name: "a Claude trailer only in commit 1 of 3",
    facts: pr({
      commits: [
        human("Add retry\n\nCo-authored-by: Claude <noreply@anthropic.com>\n"),
        human("Address review comments\n"),
        human("Fix the lint warning\n"),
      ],
    }),
  },
  {
    name: "a Devin noreply trailer",
    facts: pr({
      commits: [
        human(
          "Bump\n\nCo-authored-by: devin-ai-integration[bot] <158243242+devin-ai-integration[bot]@users.noreply.github.com>\n",
        ),
      ],
    }),
  },
  {
    name: "a Copilot noreply trailer",
    facts: pr({ commits: [human("Docs\n\nCo-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>\n")] }),
  },
  {
    name: "an extraLogins noreply trailer",
    facts: pr(
      { commits: [human("Data\n\nCo-authored-by: Acme <12345+Acme-Agent@users.noreply.github.com>\n")] },
      { extraLogins: ["acme-agent"] },
    ),
  },
  { name: "the label AI-Generated", facts: pr({ labels: ["AI-Generated"] }) },
  { name: "the label Bot-PR with labels [bot-pr]", facts: pr({ labels: ["Bot-PR"] }, { labels: ["bot-pr"] }) },
  { name: "the label agent with labels [bot-pr]", facts: pr({ labels: ["agent"] }, { labels: ["bot-pr"] }) },
  { name: "an unknown author", facts: pr({ author: null }) },
  { name: "unreadable commits", facts: pr({ commits: null }) },
  { name: "truncated commits", facts: pr({ commitsIncomplete: true }) },
  { name: "an unknown author and unreadable commits", facts: pr({ author: null, commits: null }) },
];

const HUMAN_TRAILER = human("Refactor the config reader\n\nCo-authored-by: Jane Roe <jane.roe@example.com>\n");

const withCommitsAdded = (facts: Facts, before: Commit[], after: Commit[]): Facts =>
  facts.pr.commits === null
    ? facts
    : { ...facts, pr: { ...facts.pr, commits: [...before, ...facts.pr.commits, ...after] } };

/** The human evidence added to each agent case: each only adds, and none of it may remove the flag. */
const ADDITIONS: { name: string; add: (facts: Facts) => Facts }[] = [
  {
    name: "human commits before and after",
    add: (f) => withCommitsAdded(f, [human("Start the branch\n")], [human("Last human touch\n")]),
  },
  { name: "human co-author trailers", add: (f) => withCommitsAdded(f, [HUMAN_TRAILER], [HUMAN_TRAILER]) },
  { name: "other labels", add: (f) => ({ ...f, pr: { ...f.pr, labels: [...f.pr.labels, "bug", "enhancement"] } }) },
  { name: "a non-matching labels list", add: (f) => ({ ...f, labels: [...(f.labels ?? []), "needs-review"] }) },
  {
    name: "a non-matching extraLogins list",
    add: (f) => ({ ...f, extraLogins: [...(f.extraLogins ?? []), "someone-else"] }),
  },
  { name: "empty lists", add: (f) => ({ ...f, labels: f.labels ?? [], extraLogins: f.extraLogins ?? [] }) },
  {
    name: "everything at once",
    add: (f) => {
      const commitsAdded = withCommitsAdded(f, [HUMAN_TRAILER, human("Start\n")], [human("End\n"), HUMAN_TRAILER]);
      return {
        ...commitsAdded,
        pr: { ...commitsAdded.pr, labels: [...commitsAdded.pr.labels, "bug"] },
        labels: [...(f.labels ?? []), "needs-review"],
        extraLogins: [...(f.extraLogins ?? []), "someone-else"],
      };
    },
  },
];

// The first test of a file loads core's index cold, which can take seconds on a loaded host.
describe("agent-pr-detection: added human evidence never removes the agent flag", { timeout: 60_000 }, () => {
  it.each(AGENT_CASES)(
    "AC-7: $name stays an agent PR, keeping its evidence, when human evidence is added",
    async ({ facts }) => {
      const { detectAgentPr } = await load();
      const original = detectAgentPr(facts);
      expect(original.isAgentPr, "the agent case itself").toBe(true);
      for (const { name, add } of ADDITIONS) {
        const added = detectAgentPr(add(facts));
        expect(added.isAgentPr, `with ${name}`).toBe(true);
        expect(added.evidence, `with ${name}`).toEqual(expect.arrayContaining(original.evidence));
      }
    },
  );
});
