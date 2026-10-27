import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24 (P07), AC-3. check() is loaded inside the test body: the AC test is written before the build adds rule
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
const p07Messages = (report: Report) => report.messages.filter((m) => m.code === "POLICY_P07");

describe("org policy rule P07: directory scope and classes it does not compare", { timeout: 60_000 }, () => {
  it("AC-3: a Python package's AGENTS.md, a file naming only pytest, and a nested AGENTS.md naming another package manager give no P07 violation and no POLICY_P07 message", async () => {
    // Control: the same runner compares two root files that name different package managers, so the empty results
    // below come from the scope and the classes, not from P07 being absent.
    const control = await run([
      { path: "AGENTS.md", text: "# Agents\n\nRun `pnpm install`.\n" },
      { path: "CLAUDE.md", text: "# Claude\n\nRun `npm install`.\n" },
    ]);
    expect(p07(control).map((v) => v.path)).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(p07Messages(control)).toHaveLength(1);

    const cases: [string, Source[]][] = [
      [
        "root pnpm vitest vs packages/py uv run pytest",
        [
          { path: "AGENTS.md", text: "# Agents\n\nRun `pnpm vitest run`.\n" },
          { path: "packages/py/AGENTS.md", text: "# Python\n\nRun `uv run pytest`.\n" },
        ],
      ],
      [
        "root AGENTS.md naming pnpm vitest and pytest vs root CLAUDE.md naming only pytest",
        [
          { path: "AGENTS.md", text: "# Agents\n\nRun `pnpm vitest` for the web code and `pytest` for the tools.\n" },
          { path: "CLAUDE.md", text: "# Claude\n\nRun `pytest`.\n" },
        ],
      ],
      [
        "root pnpm install vs nested packages/app npm install",
        [
          { path: "AGENTS.md", text: "# Agents\n\nRun `pnpm install`.\n" },
          { path: "packages/app/AGENTS.md", text: "# App\n\nRun `npm install`.\n" },
        ],
      ],
    ];
    for (const [label, files] of cases) {
      const report = await run(files);
      expect(p07(report), label).toEqual([]);
      expect(p07Messages(report), label).toEqual([]);
    }
  });
});
