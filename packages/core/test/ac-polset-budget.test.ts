import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings), AC-16. check() is loaded inside the test body: the AC test is written before the build
// adds the settings rules, so nothing the build adds may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";
const BUDGET = 2 ** 26;

async function run(forbidden: string[], allow: string[]): Promise<Report> {
  const document = {
    version: 1,
    setup: {
      forbidden_permissions: forbidden,
      required_permissions_deny: ["Bash(rm -rf:*)"],
      required_hooks: [{ event: "Stop" }],
      allowed_mcp_servers: ["github"],
      forbidden_mcp_servers: ["evil"],
    },
  };
  const settings = `${JSON.stringify({ permissions: { allow, defaultMode: "bypassPermissions" } }, null, 2)}\n`;
  const mcp = `${JSON.stringify({ mcpServers: { evil: { command: "node" }, notes: { command: "node" } } }, null, 2)}\n`;
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts", ".claude/settings.json", ".mcp.json"],
    policy: { source: "file", version: null, path: "policy/org.json", document },
    policySettingsSources: {
      files: [
        { path: ".claude/settings.json", text: settings },
        { path: ".mcp.json", text: mcp },
      ],
      dropped: [],
    },
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const ids = (report: Report) => new Set((report.policy?.violations ?? []).map((v) => v.id));
const invalid = (report: Report) => report.messages.filter((m) => m.code === "POLICY_SETTINGS_INVALID");

describe("the compare budget", { timeout: 120_000 }, () => {
  it("AC-16: over 2^26 pair units P02, P03 and P05 compare nothing and one compare-budget error is reported, while P04 and P06 still run; under it the rules run as normal", async () => {
    // 1,000 forbidden and 300 allowed Bash patterns of 512 characters: one family, so every pair counts.
    const pad = (head: string) => `${head}${"x".repeat(512 - head.length - 1)})`;
    const forbidden = Array.from({ length: 1000 }, (_, i) => pad(`Bash(forbid${i} `));
    const allow = Array.from({ length: 300 }, (_, i) => pad(`Bash(allow${i} `));
    for (const rule of [...forbidden, ...allow]) expect(rule).toHaveLength(512);
    const pairUnits = forbidden.length * allow.length * 513 * 513;
    expect(pairUnits, "control: the pair sum is over the budget").toBeGreaterThan(BUDGET);

    const over = await run(forbidden, allow);
    for (const id of ["P02", "P03", "P05"]) expect(ids(over).has(id), `over budget: no ${id} violation`).toBe(false);
    expect(ids(over).has("P04"), "over budget: P04 still runs (notes is not listed)").toBe(true);
    expect(ids(over).has("P06"), "over budget: P06 still runs (no Stop hook)").toBe(true);
    expect(invalid(over)).toEqual([
      {
        level: "error",
        code: "POLICY_SETTINGS_INVALID",
        text: "P02–P06 could not fully use these agent settings files: the rule comparison (`compare-budget`). Claude Code skips an unparseable file or entry; pharn-ci never guesses what it meant, and a file it could not read counts against the policy.",
      },
    ]);
    expect(over.verdict).toBe("fail");

    // Under the budget the same shape gives its normal violations and no compare-budget problem.
    const under = await run(["Bash(curl:*)"], ["Bash(curl:*)", "Bash(ls)"]);
    for (const id of ["P02", "P03", "P04", "P05", "P06"]) {
      expect(ids(under).has(id), `under budget: a ${id} violation`).toBe(true);
    }
    expect(invalid(under), "under budget: no problem at all").toEqual([]);
  });
});
