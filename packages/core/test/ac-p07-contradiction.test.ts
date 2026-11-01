import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24 (P07), AC-1. check() is loaded inside the test body and fixtures/policy-rules/p07/ is read there too: the
// AC test is written before the build adds rule P07 and its fixtures, so nothing the build adds may run while this
// file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
type Source = { path: string; text: string };

const REPO_ROOT = "/home/runner/work/demo/demo";
const APP = { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: { version: 1 } };

async function run(files: Source[] | undefined): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "CLAUDE.md", "src/a.ts"],
    policy: APP,
    ...(files === undefined ? {} : { agentInstructionSources: { files, dropped: [] } }),
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const p07 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P07");
/** The text without one trailing newline. */
const body = (text: string) => (text.endsWith("\n") ? text.slice(0, -1) : text);

describe("org policy rule P07: two root instruction files name different package managers", { timeout: 60_000 }, () => {
  it("AC-1: AGENTS.md (pnpm) and CLAUDE.md (npm) give two warn P07 violations with their lines and fixed details, one POLICY_P07 warn message, the same verdict as without instruction sources, and a valid report", async () => {
    const agents = fixture("policy-rules/p07/contradiction/agents.txt");
    const claude = fixture("policy-rules/p07/contradiction/claude.txt");
    // The fixtures hold the SPEC's texts.
    expect(body(agents)).toBe("# Agents\n\nRun `pnpm install`, then `pnpm test`.");
    expect(body(claude)).toBe("# Claude\n\n```sh\nnpm install\nnpm test\n```");

    const report = await run([
      { path: "AGENTS.md", text: agents },
      { path: "CLAUDE.md", text: claude },
    ]);
    expect(p07(report).map((v) => ({ path: v.path, line: v.line, severity: v.severity, detail: v.detail }))).toEqual([
      { path: "AGENTS.md", line: 3, severity: "warn", detail: "package manager: pnpm here, npm in CLAUDE.md:4" },
      { path: "CLAUDE.md", line: 4, severity: "warn", detail: "package manager: npm here, pnpm in AGENTS.md:3" },
    ]);

    const messages = report.messages.filter((m) => m.code === "POLICY_P07");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("warn");
    expect(messages[0]?.text).toBe(
      "2 agent instruction files name a different package manager or test runner than another file in the same directory: `AGENTS.md`, `CLAUDE.md`. Each file's line is in the report's policy violations.",
    );

    const without = await run(undefined);
    expect(p07(without)).toEqual([]);
    expect(report.verdict).toBe(without.verdict);
  });
});
