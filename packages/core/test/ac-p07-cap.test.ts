import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24 (P07), AC-13. check() is loaded inside the test body: the AC test is written before the build adds rule
// P07, so nothing the build adds may run while this file loads. The instruction files are generated here.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
type Source = { path: string; text: string };

const REPO_ROOT = "/home/runner/work/demo/demo";
const APP = { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: { version: 1 } };
/** `pnpm install` on line 3. */
const AGENTS: Source = { path: "AGENTS.md", text: "# Agents\n\nRun `pnpm install`.\n" };
/** `npm install` on line 1. */
const rule = (i: number): Source => ({
  path: `.cursor/rules/r${String(i).padStart(2, "0")}.mdc`,
  text: "Run `npm install`.\n",
});

async function run(files: Source[]): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: [...files.map((f) => f.path), "src/a.ts"],
    policy: APP,
    agentInstructionSources: { files, dropped: [] },
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

describe("org policy rule P07: the cap", { timeout: 60_000 }, () => {
  it("AC-13: 60 contradicting files keep 50 violations and say 10 are not listed; 51 say 1 is not listed; a third contradicting file adds `and 1 other file` to the detail", async () => {
    const rules60 = Array.from({ length: 59 }, (_, i) => rule(i));
    const sixty = await run([AGENTS, ...rules60]);
    expect(p07(sixty)).toHaveLength(50);
    expect(p07Text(sixty)).toContain(" 10 of the violations are not listed in the report.");
    const r00 = p07(sixty).find((v) => v.path === ".cursor/rules/r00.mdc");
    expect(r00?.detail).toBe("package manager: npm here, pnpm in AGENTS.md:3");

    const rules51 = Array.from({ length: 50 }, (_, i) => rule(i));
    const fiftyOne = await run([AGENTS, ...rules51]);
    expect(p07(fiftyOne)).toHaveLength(50);
    expect(p07Text(fiftyOne)).toContain(" 1 of the violations is not listed in the report.");
    expect(p07(fiftyOne).find((v) => v.path === ".cursor/rules/r00.mdc")?.detail).toBe(
      "package manager: npm here, pnpm in AGENTS.md:3",
    );

    const three = await run([
      AGENTS,
      { path: "CLAUDE.md", text: "# Claude\n\nRun `npm install`.\n" },
      { path: "GEMINI.md", text: "# Gemini\n\nRun `npm install`.\n" },
    ]);
    expect(p07(three).find((v) => v.path === "AGENTS.md")?.detail).toBe(
      "package manager: pnpm here, npm in CLAUDE.md:3 and 1 other file",
    );
  });
});
