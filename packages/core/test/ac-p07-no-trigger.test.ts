import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24 (P07), AC-5. check() is loaded inside the test body: the AC test is written before the build adds rule
// P07, so nothing the build adds may run while this file loads. The instruction texts are built here from the SPEC.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
type Source = { path: string; text: string };

const REPO_ROOT = "/home/runner/work/demo/demo";
const APP = { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: { version: 1 } };
const AGENTS = { path: "AGENTS.md", text: "# Agents\n\nRun `pnpm install`.\n" };

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
const claude = (body: string) => ({ path: "CLAUDE.md", text: `# Claude\n\n${body}\n` });

describe("org policy rule P07: what does not trigger it", { timeout: 60_000 }, () => {
  it("AC-5: prose, a global install, npx playwright, a json block and config-like spans, a prompt-less console line, an HTML comment, and a lone file naming several tools give no P07 violation and no POLICY_P07 message", async () => {
    // Control: the same runner compares AGENTS.md (pnpm) with a CLAUDE.md that declares npm in a code span, so the
    // empty results below come from the extraction rules, not from P07 being absent.
    const control = await run([AGENTS, claude("Run `npm install`.")]);
    expect(p07(control).map((v) => v.path)).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(p07Messages(control)).toHaveLength(1);

    const cases: [string, Source[]][] = [
      ["prose only", [AGENTS, claude("We never use npm or yarn.")]],
      ["a global install of pnpm, then pnpm install", [AGENTS, claude("Run `npm i -g pnpm`, then `pnpm install`.")]],
      ["npx playwright test", [AGENTS, claude("Run `npx playwright test`.")]],
      [
        "a json block and config-like spans",
        [
          AGENTS,
          claude(
            '```json\n{\n  "scripts": {\n    "test": "jest"\n  }\n}\n```\n\nSee `jest.config.js`, `@vitest/coverage-v8` and `ts-jest`.',
          ),
        ],
      ],
      ["a console block with no prompt", [AGENTS, claude("```console\nnpm WARN deprecated\n```")]],
      ["an HTML comment", [AGENTS, claude("<!-- npm install -->")]],
      [
        "a lone CLAUDE.md naming npm and yarn",
        [claude("Run `npm test` or `yarn test`.\n\nInstall with `yarn install` or `npm install`.")],
      ],
    ];
    for (const [label, files] of cases) {
      const report = await run(files);
      expect(p07(report), label).toEqual([]);
      expect(p07Messages(report), label).toEqual([]);
    }
  });
});
