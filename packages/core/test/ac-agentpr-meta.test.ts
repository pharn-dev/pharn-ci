import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// The agents module and check() are loaded inside each test body, and fixtures/agent-pr/ is read there too: the AC
// tests are written before the build adds them, so nothing the build adds may run while this file loads.

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
type Report = Record<string, unknown> & { meta?: Record<string, unknown> };

interface MetaModule {
  detectAgentPr(facts: Facts): Detection;
  agentPrMetaFields(detection: Detection, facts: Facts): Record<string, unknown>;
  withAgentPrMeta(report: Report, detection: Detection, facts: Facts): Report;
}

const load = async () => (await import("../src/index.js")) as unknown as MetaModule;

const ROOT = new URL("../../../", import.meta.url);
const agentPrFixture = (name: string) => readFileSync(new URL(`fixtures/agent-pr/${name}`, ROOT), "utf8");

const HUMAN_AUTHOR = { login: "octocat", type: "User" };
const human = (message: string): Commit => ({ authorLogin: "octocat", committerLogin: "octocat", message });
const humanPr = (commits: Commit[], extra: Partial<Facts> = {}): Facts => ({
  pr: { author: HUMAN_AUTHOR, labels: [], commits },
  ...extra,
});

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

async function goldenReport(extra: Record<string, unknown> = {}): Promise<Report> {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: 80,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    ...extra,
  };
  return check(input as Parameters<typeof check>[0]) as unknown as Report;
}

// The first test of a file loads core's index cold, which can take seconds on a loaded host.
describe("agent-pr-detection: the report meta fields", { timeout: 60_000 }, () => {
  it("AC-8: a human PR with the human-coauthor.txt commit keeps no co-author and no trace of the person", async () => {
    const { detectAgentPr, agentPrMetaFields } = await load();
    const facts = humanPr([human(agentPrFixture("human-coauthor.txt"))]);
    const detection = detectAgentPr(facts);
    const fields = agentPrMetaFields(detection, facts);
    expect(fields.isAgentPr).toBe(false);
    expect(fields.coAuthors).toEqual([]);
    for (const json of [JSON.stringify(fields), JSON.stringify(detection)]) {
      expect(json).not.toContain("Jane");
      expect(json).not.toContain("jane.roe");
      expect(json).not.toContain("example.com");
    }
  });

  it("AC-8: a trailer Jane Roe <noreply@anthropic.com> is recorded by its hint, never by its name", async () => {
    const { detectAgentPr, agentPrMetaFields } = await load();
    const facts = humanPr([human("Fix the loader\n\nCo-authored-by: Jane Roe <noreply@anthropic.com>\n")]);
    const detection = detectAgentPr(facts);
    const fields = agentPrMetaFields(detection, facts);
    expect(fields.coAuthors).toEqual(["claude-code <noreply@anthropic.com>"]);
    expect(JSON.stringify(fields)).not.toContain("Jane");
    expect(JSON.stringify(detection)).not.toContain("Jane");
  });

  it("AC-8: duplicate agent trailers collapse to one entry", async () => {
    const { detectAgentPr, agentPrMetaFields } = await load();
    const facts = humanPr([
      human("One\n\nCo-authored-by: Claude <noreply@anthropic.com>\n"),
      human("Two\n\nCo-authored-by: Claude <noreply@anthropic.com>\nCo-authored-by: Claude <noreply@anthropic.com>\n"),
      human("Three\n\nCo-authored-by: CLAUDE <NoReply@Anthropic.com>\n"),
    ]);
    const fields = agentPrMetaFields(detectAgentPr(facts), facts);
    expect(fields.coAuthors).toEqual(["claude-code <noreply@anthropic.com>"]);
  });

  it("AC-8: at most 20 co-authors are kept, in first-appearance order", async () => {
    const { detectAgentPr, agentPrMetaFields } = await load();
    const logins = Array.from({ length: 25 }, (_, i) => `agent-${i + 1}`);
    const facts = humanPr(
      logins.map((login, i) =>
        human(`Change ${i}\n\nCo-authored-by: Bot ${i} <${i + 1}+${login}@users.noreply.github.com>\n`),
      ),
      { extraLogins: logins },
    );
    const detection = detectAgentPr(facts);
    expect(detection.isAgentPr).toBe(true);
    const coAuthors = agentPrMetaFields(detection, facts).coAuthors as string[];
    expect(coAuthors).toHaveLength(20);
    coAuthors.forEach((entry, i) => {
      expect(entry.startsWith(`agent-${i + 1} `), entry).toBe(true);
    });
  });

  it("AC-8: prLabels keeps at most 100 labels of at most 50 code points each", async () => {
    const { detectAgentPr, agentPrMetaFields } = await load();
    const labels = ["🤖".repeat(60), "x".repeat(70), ...Array.from({ length: 118 }, (_, i) => `label-${i + 2}`)];
    const facts: Facts = { pr: { author: HUMAN_AUTHOR, labels, commits: [human("Fix the parser\n")] } };
    const prLabels = agentPrMetaFields(detectAgentPr(facts), facts).prLabels as string[];
    expect(prLabels).toHaveLength(100);
    expect(prLabels[0]).toBe("🤖".repeat(50));
    expect(prLabels[1]).toBe("x".repeat(50));
    expect(prLabels[99]).toBe("label-99");
    for (const label of prLabels) expect(Array.from(label).length).toBeLessThanOrEqual(50);
  });

  it("AC-8: pr null gives exactly { isAgentPr: false }", async () => {
    const { detectAgentPr, agentPrMetaFields } = await load();
    const facts: Facts = { pr: null };
    const fields = agentPrMetaFields(detectAgentPr(facts), facts);
    expect(fields).toStrictEqual({ isAgentPr: false });
    expect(Object.keys(fields)).toEqual(["isAgentPr"]);
  });

  it("AC-8: withAgentPrMeta on a check() report with meta is a valid v2 report with verdict and messages unchanged", async () => {
    const { detectAgentPr, withAgentPrMeta } = await load();
    const report = await goldenReport({ meta: META });
    const agentFacts: Facts = {
      pr: {
        author: { login: "claude[bot]", type: "Bot" },
        labels: ["agent"],
        commits: [{ authorLogin: "claude[bot]", committerLogin: "claude[bot]", message: "Add retry\n" }],
      },
    };
    const agent = withAgentPrMeta(report, detectAgentPr(agentFacts), agentFacts);
    expectValidReport(agent);
    expect(agent.verdict).toEqual(report.verdict);
    expect(agent.messages).toEqual(report.messages);
    expect(agent.meta?.isAgentPr).toBe(true);
    expect(agent.meta?.agentHint).toBe("claude-code");
    expect(agent.meta?.prAuthor).toEqual({ login: "claude[bot]", type: "Bot" });
    expect(agent.meta?.prLabels).toEqual(["agent"]);
    expect(agent.meta?.runId).toBe(META.runId);

    const humanFacts = humanPr([human(agentPrFixture("human-coauthor.txt"))]);
    const humanReport = withAgentPrMeta(report, detectAgentPr(humanFacts), humanFacts);
    expectValidReport(humanReport);
    expect(humanReport.verdict).toEqual(report.verdict);
    expect(humanReport.messages).toEqual(report.messages);
    expect(humanReport.meta?.isAgentPr).toBe(false);
    expect(humanReport.meta?.coAuthors).toEqual([]);
  });

  it("AC-8: a report without meta is returned unchanged", async () => {
    const { detectAgentPr, withAgentPrMeta } = await load();
    const report = await goldenReport();
    const before = structuredClone(report);
    const facts: Facts = { pr: { author: { login: "claude[bot]", type: "Bot" }, labels: ["agent"], commits: [] } };
    const result = withAgentPrMeta(report, detectAgentPr(facts), facts);
    expect(result).toStrictEqual(before);
    expect("meta" in result).toBe(false);
  });
});
