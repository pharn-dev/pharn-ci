import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24 (P07), AC-12. check() is loaded inside the test body and fixtures/policy-rules/p07/ is read there too: the
// AC test is written before the build adds rule P07 and its fixtures, so nothing the build adds may run while this
// file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
type Sources =
  | { files: { path: string; text: string }[]; dropped: { path: string; reason: string }[] }
  | { unavailable: string };

const REPO_ROOT = "/home/runner/work/demo/demo";
const NOW = "2026-10-26T12:00:00.000Z";
const POLICIES = {
  app: { source: "app", version: 3, fetchedAt: NOW, document: { version: 1 } },
  file: { source: "file", version: null, path: ".pharn/policy.json", document: { version: 1 } },
  blocking: { source: "app", version: 3, fetchedAt: NOW, document: { version: 1, setup: { consistency: "block" } } },
} as const;
type PolicyName = keyof typeof POLICIES;

const UNREAD_DETAIL = "agent instruction files were not read; P07 did not compare them";
const UNREAD_TEXT = "The agent instruction files were not read, so they were not compared.";
const dropDetail = (n: number) =>
  `${n} agent instruction ${n === 1 ? "file was" : "files were"} not compared (binary, too large, past the read caps or an unsafe path)`;
const MISSING_DETAIL = "1 agent instruction file was not compared (not a file at HEAD)";
const CONTRADICTION_TEXT =
  "2 agent instruction files name a different package manager or test runner than another file in the same directory: `AGENTS.md`, `CLAUDE.md`. Each file's line is in the report's policy violations.";
const DROP_SENTENCE =
  " 1 agent instruction file was not compared: binary, too large, past the read caps, an unsafe path or not a file at HEAD.";

async function run(policy: PolicyName, sources: Sources): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".pharn/policy.json", "src/a.ts"],
    policy: POLICIES[policy],
    agentInstructionSources: sources,
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const p07 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P07");
function p07Text(report: Report): string {
  const messages = report.messages.filter((m) => m.code === "POLICY_P07");
  expect(messages).toHaveLength(1);
  return messages[0]?.text ?? "";
}
const pathless = (report: Report) =>
  p07(report)
    .filter((v) => v.path === null)
    .map((v) => ({ line: v.line, severity: v.severity, detail: v.detail }));

describe("org policy rule P07: files that were not read or not compared", { timeout: 60_000 }, () => {
  it("AC-12: unavailable sources give one info violation; PR-controlled drops take P07's severity; a missing file is info; a drop beside a contradiction adds the drop sentence to the message", async () => {
    const agentsText = fixture("policy-rules/p07/contradiction/agents.txt");
    const claudeText = fixture("policy-rules/p07/contradiction/claude.txt");
    const AGENTS = { path: "AGENTS.md", text: agentsText };

    for (const policy of Object.keys(POLICIES) as PolicyName[]) {
      // Unavailable: one path-less info violation under every policy.
      const unread = await run(policy, { unavailable: "git cat-file --batch-check failed: boom" });
      expect(
        p07(unread).map((v) => ({ path: v.path, line: v.line, severity: v.severity, detail: v.detail })),
        policy,
      ).toEqual([{ path: null, line: null, severity: "info", detail: UNREAD_DETAIL }]);
      expect(p07Text(unread), policy).toBe(UNREAD_TEXT);

      // One file dropped as too-large: P07's resolved severity.
      const severity = policy === "blocking" ? "block" : "warn";
      const tooLarge = await run(policy, { files: [AGENTS], dropped: [{ path: "CLAUDE.md", reason: "too-large" }] });
      expect(p07(tooLarge), policy).toHaveLength(1);
      expect(pathless(tooLarge), policy).toEqual([{ line: null, severity, detail: dropDetail(1) }]);
      if (policy === "blocking") expect(tooLarge.verdict).toBe("fail");

      // Two files dropped, over-file-cap and binary: one violation counting both.
      const twoDrops = await run(policy, {
        files: [AGENTS],
        dropped: [
          { path: "CLAUDE.md", reason: "over-file-cap" },
          { path: "GEMINI.md", reason: "binary" },
        ],
      });
      expect(p07(twoDrops), policy).toHaveLength(1);
      expect(pathless(twoDrops), policy).toEqual([{ line: null, severity, detail: dropDetail(2) }]);

      // One file dropped as missing: info under every policy.
      const missing = await run(policy, { files: [AGENTS], dropped: [{ path: "CLAUDE.md", reason: "missing" }] });
      expect(p07(missing), policy).toHaveLength(1);
      expect(pathless(missing), policy).toEqual([{ line: null, severity: "info", detail: MISSING_DETAIL }]);

      // An unsafe-path drop beside the contradicting files of AC-1.
      const mixed = await run(policy, {
        files: [AGENTS, { path: "CLAUDE.md", text: claudeText }],
        dropped: [{ path: "docs/../GEMINI.md", reason: "unsafe-path" }],
      });
      expect(pathless(mixed), policy).toEqual([{ line: null, severity, detail: dropDetail(1) }]);
      expect(
        p07(mixed)
          .filter((v) => v.path !== null)
          .map((v) => v.path),
        policy,
      ).toEqual(["AGENTS.md", "CLAUDE.md"]);
      expect(p07Text(mixed), policy).toBe(`${CONTRADICTION_TEXT}${DROP_SENTENCE}`);
    }
  });
});
