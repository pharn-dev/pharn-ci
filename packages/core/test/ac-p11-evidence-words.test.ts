import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-10. check() is loaded inside the test body: the AC test is written before the build adds
// rule P11, so nothing the build adds may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";
const DIFF = [
  "diff --git a/infra/main.tf b/infra/main.tf",
  "index 1111111..2222222 100644",
  "--- a/infra/main.tf",
  "+++ b/infra/main.tf",
  "@@ -2,0 +3 @@",
  "+x",
  "",
].join("\n");
const HUMAN_COMMITS = [{ authorLogin: "octocat", committerLogin: "octocat", message: "Fix the parser\n" }];
const HUMAN = { login: "octocat", type: "User" };

async function p11Text(pr: unknown): Promise<string> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: DIFF },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "infra/main.tf"],
    policy: {
      source: "app",
      version: 3,
      fetchedAt: "2026-10-26T12:00:00.000Z",
      document: { version: 1, agents: { protected_paths: ["infra/**"] } },
    },
    agentPrFacts: { pr },
  } as never) as unknown as Report;
  expectValidReport(report);
  expect((report.policy?.violations ?? []).filter((v) => v.id === "P11").map((v) => v.path)).toEqual(["infra/main.tf"]);
  const messages = report.messages.filter((m) => m.code === "POLICY_P11");
  expect(messages).toHaveLength(1);
  return messages[0]?.text ?? "";
}

describe("org policy rule P11: the evidence sentence", { timeout: 60_000 }, () => {
  it("AC-10: the POLICY_P11 text ends with the fixed words of every evidence in detection order, then the incomplete word, joined by '; ', and never starts with a space", async () => {
    const label = await p11Text({ author: HUMAN, labels: ["ai-generated"], commits: HUMAN_COMMITS });
    expect(label.endsWith(" It counts as an agent PR by: an agent label."), label).toBe(true);

    const bot = await p11Text({ author: { login: "claude[bot]", type: "Bot" }, labels: [], commits: HUMAN_COMMITS });
    expect(bot.endsWith(" It counts as an agent PR by: a bot author; a known agent as author."), bot).toBe(true);

    const unreadable = await p11Text({ author: HUMAN, labels: ["ai-generated"], commits: null });
    expect(
      unreadable.endsWith(
        " It counts as an agent PR by: an agent label; evidence it could not read (`commits-unreadable`).",
      ),
      unreadable,
    ).toBe(true);

    for (const text of [label, bot, unreadable]) {
      expect(text.startsWith(" "), text).toBe(false);
      expect(text.startsWith("This agent pull request changes 1 path the org policy protects: "), text).toBe(true);
      expect(text).toContain("`infra/main.tf`");
    }
  });
});
