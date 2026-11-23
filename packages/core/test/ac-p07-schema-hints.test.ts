import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeRow } from "./codeTable.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24 (P07), AC-20. Reads the schema as text; check() and renderMarkdown() are loaded inside the test body: the
// AC test is written before the build adds the code, so nothing the build adds may run while this file loads.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

// CORE-140: the comment's hint is the code's fix.hint, the one advice text of POLICY_P07.
const P07_HINT =
  "A maintainer should make the agent instruction files agree on one package manager and one test runner.";

type Message = { level: string; code: string; text: string };
type Report = Record<string, unknown> & { messages: Message[] };
interface Core {
  check(input: unknown): Report;
  renderMarkdown(report: Report): string;
}

describe("the schema sentence and the hint for POLICY_P07", { timeout: 60_000 }, () => {
  it("AC-20: the code table documents POLICY_P07; a report with POLICY_P07 validates; the hint is the fixed text", async () => {
    // CORE-132: the comparison of the code description and of report.v1.json with an old commit was a history pin and
    // is removed. CORE-140: the code description is one sentence and a link to the code table, which names the code.
    expect(codeRow("POLICY_P07")).toContain("(`warn` by default;");

    // A report carrying POLICY_P07 validates and renders the hint.
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const report = core.check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("diff/empty.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: null,
      repoFiles: ["AGENTS.md", "CLAUDE.md", "src/a.ts"],
      policy: { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: { version: 1 } },
      agentInstructionSources: {
        files: [
          { path: "AGENTS.md", text: "# Agents\n\nRun `pnpm install`.\n" },
          { path: "CLAUDE.md", text: "# Claude\n\nRun `npm install`.\n" },
        ],
        dropped: [],
      },
    });
    expectValidReport(report);
    expect(report.messages.map((m) => m.code)).toContain("POLICY_P07");
    expectValidReport({ ...report, messages: report.messages.filter((m) => m.code === "POLICY_P07") });

    const markdown = core.renderMarkdown(report);
    expect(markdown).toContain(`  - Hint: ${P07_HINT}`);
    // The hint is written once, in the fix table's P07 entry, and is the message's fix.hint.
    const source = read("packages/core/src/fix/table.ts");
    const entry = source.indexOf("  P07: {");
    expect(entry, "SIGNAL_FIXES.P07 in fix/table.ts").toBeGreaterThanOrEqual(0);
    expect(source.slice(entry, entry + 400)).toContain(JSON.stringify(P07_HINT));
    const message = report.messages.find((m) => m.code === "POLICY_P07") as Message & { fix?: { hint: string } };
    expect(message.fix?.hint).toBe(P07_HINT);
    // CORE-133: the README row check moved to docs-contract.test.ts, which checks a row for every code.
  });
});
