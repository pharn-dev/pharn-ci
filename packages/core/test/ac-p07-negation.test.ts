import { describe, expect, it } from "vitest";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24 (P07), AC-4. check() and instructionDeclarations() are loaded inside the test body: the AC test is written
// before the build adds rule P07 and the extractor, so nothing the build adds may run while this file loads.

type Source = { path: string; text: string };
/** check() (coverage as text) and the instructions module, as the test body builds them. */
type Core = typeof import("./text-coverage.js") & typeof import("../src/setup/instructions.js");

const REPO_ROOT = "/home/runner/work/demo/demo";
const APP: ResolvedPolicy = {
  source: "app",
  version: 3,
  fetchedAt: "2026-10-26T12:00:00.000Z",
  document: { version: 1 },
};
const AGENTS = "# Agents\n\nRun `pnpm install`.\n";

/** The five CLAUDE.md texts of the SPEC, in order. */
const CLAUDE_TEXTS = [
  "# Claude\n\nDon't use `npm install`; use `pnpm install`.\n",
  "# Claude\n\n`npm install` is not supported.\n",
  "# Claude\n\nUse `pnpm i` instead of `npm i`.\n",
  "# Claude\n\n`npm i` isn't used here.\n",
  "# Claude\n\n## Don't\n\n- `npm install`\n\n## Setup\n\n- `pnpm install`\n",
];

async function run(core: Core, files: Source[]): Promise<Report> {
  const report = core.check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: [...files.map((f) => f.path), "src/a.ts"],
    policy: APP,
    agentInstructionSources: { files, dropped: [] },
  });
  expectValidReport(report);
  return report as Report;
}

const p07 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P07");

describe("org policy rule P07: negated mentions", { timeout: 60_000 }, () => {
  it("AC-4: a negating cue before a span, `is not` or `isn't` after it, `instead of`, and a `## Don't` section keep npm from contradicting pnpm; instructionDeclarations gives pnpm for texts 1, 3 and 5 and nothing for 2 and 4", async () => {
    const core = {
      ...(await import("./text-coverage.js")),
      ...(await import("../src/setup/instructions.js")),
    };
    expect(typeof core.instructionDeclarations).toBe("function");

    for (const [i, claude] of CLAUDE_TEXTS.entries()) {
      const report = await run(core, [
        { path: "AGENTS.md", text: AGENTS },
        { path: "CLAUDE.md", text: claude },
      ]);
      expect(p07(report), `CLAUDE.md text ${i + 1}`).toEqual([]);
    }

    for (const i of [0, 2, 4]) {
      const declared = core.instructionDeclarations(CLAUDE_TEXTS[i] as string);
      expect(declared.packageManagers.tools, `CLAUDE.md text ${i + 1}`).toEqual(["pnpm"]);
    }
    for (const i of [1, 3]) {
      const declared = core.instructionDeclarations(CLAUDE_TEXTS[i] as string);
      expect(declared.packageManagers, `CLAUDE.md text ${i + 1}`).toEqual({ tools: [], line: null });
    }
  });
});
