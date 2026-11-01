import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24 (P07), AC-2. check() is loaded inside the test body: the AC test is written before the build adds rule
// P07, so nothing the build adds may run while this file loads. The instruction texts are built here from the SPEC.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
type Source = { path: string; text: string };

const REPO_ROOT = "/home/runner/work/demo/demo";
const APP = { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: { version: 1 } };

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
/** A heading, a blank line and one prose line holding `command` in a code span: the declaration is on line 3. */
const prose = (title: string, command: string) => `# ${title}\n\nRun \`${command}\`.\n`;

describe("org policy rule P07: what triggers it", { timeout: 60_000 }, () => {
  it("AC-2: a test-runner contradiction (npx vitest vs npx jest), a nested scope (yarn vs bun), an alwaysApply cursor rule (yarn vs pnpm) and a console-block $ npm ci (vs pnpm) each give two violations", async () => {
    // 1. Root CLAUDE.md with npx vitest run vs .github/copilot-instructions.md with npx jest.
    const runners = await run([
      { path: "CLAUDE.md", text: prose("Claude", "npx vitest run") },
      { path: ".github/copilot-instructions.md", text: prose("Copilot", "npx jest") },
    ]);
    const runnerDetails = p07(runners).map((v) => v.detail);
    expect(runnerDetails).toHaveLength(2);
    for (const detail of runnerDetails) expect(detail.startsWith("test runner: "), detail).toBe(true);
    expect(runnerDetails.some((d) => d.startsWith("package manager: "))).toBe(false);
    expect(runnerDetails).toContain("test runner: vitest here, jest in .github/copilot-instructions.md:3");

    // 2. packages/web/AGENTS.md with yarn test vs packages/web/CLAUDE.md with bun install.
    const nested = await run([
      { path: "packages/web/AGENTS.md", text: prose("Agents", "yarn test") },
      { path: "packages/web/CLAUDE.md", text: prose("Claude", "bun install") },
    ]);
    const nestedViolations = p07(nested);
    expect(nestedViolations.map((v) => v.path)).toEqual(["packages/web/AGENTS.md", "packages/web/CLAUDE.md"]);
    expect(nestedViolations[0]?.detail).toContain("packages/web/CLAUDE.md");
    expect(nestedViolations[1]?.detail).toContain("packages/web/AGENTS.md");

    // 3. .cursor/rules/always.mdc with alwaysApply: true and no globs (yarn install) vs root AGENTS.md (pnpm install).
    const cursor = await run([
      { path: ".cursor/rules/always.mdc", text: "---\nalwaysApply: true\n---\nRun `yarn install`.\n" },
      { path: "AGENTS.md", text: prose("Agents", "pnpm install") },
    ]);
    expect(p07(cursor).map((v) => v.path)).toEqual([".cursor/rules/always.mdc", "AGENTS.md"]);

    // 4. A console block with `$ npm ci` in CLAUDE.md vs pnpm install in AGENTS.md.
    const consoleBlock = await run([
      { path: "CLAUDE.md", text: "# Claude\n\n```console\n$ npm ci\n```\n" },
      { path: "AGENTS.md", text: prose("Agents", "pnpm install") },
    ]);
    const byPath = new Map(p07(consoleBlock).map((v) => [v.path, v]));
    expect([...byPath.keys()].sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(byPath.get("CLAUDE.md")?.line).toBe(4);
    expect(byPath.get("CLAUDE.md")?.detail).toBe("package manager: npm here, pnpm in AGENTS.md:3");
  });
});
