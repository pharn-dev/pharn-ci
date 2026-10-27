import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24 (P07), AC-6. check() is loaded inside the test body: the AC test is written before the build adds rule
// P07, so nothing the build adds may run while this file loads. The instruction texts are built here from the SPEC.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
type Source = { path: string; text: string };

const REPO_ROOT = "/home/runner/work/demo/demo";
const APP = { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: { version: 1 } };
const AGENTS = { path: "AGENTS.md", text: "# Agents\n\nRun `pnpm vitest run`.\n" };

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

describe("org policy rule P07: files limited to path patterns", { timeout: 60_000 }, () => {
  it("AC-6: an applyTo web/** instructions file and a .claude/rules file with a paths list are not compared; an applyTo ** instructions file is, and contradicts AGENTS.md on the test runner", async () => {
    const web = await run([
      AGENTS,
      {
        path: ".github/instructions/web.instructions.md",
        text: '---\napplyTo: "web/**"\n---\n# Web\n\nRun `npx jest`.\n',
      },
    ]);
    expect(p07(web), "applyTo web/**").toEqual([]);

    const rule = await run([
      AGENTS,
      {
        path: ".claude/rules/py.md",
        text: '---\npaths:\n  - "py/**"\n---\n# Python helpers\n\nRun `npm test`, then `npx jest`.\n',
      },
    ]);
    expect(p07(rule), "paths list").toEqual([]);

    const all = await run([
      AGENTS,
      {
        path: ".github/instructions/all.instructions.md",
        text: '---\napplyTo: "**"\n---\n# All\n\nRun `npx jest`.\n',
      },
    ]);
    const scoped = p07(all).filter((v) => v.path === ".github/instructions/all.instructions.md");
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.detail.startsWith("test runner: jest here, vitest in AGENTS.md:"), scoped[0]?.detail).toBe(true);
  });
});
