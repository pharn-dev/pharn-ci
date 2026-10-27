import { describe, expect, it } from "vitest";
import { measureGrowth, threadCpuMs } from "./growth.js";
import { fixture } from "./helpers.js";

// E3 item 23 (policy settings), AC-23. parseSettingsJson() and check() are loaded inside the test body: the AC test is
// written before the build adds them, so nothing the build adds may run while this file loads. Growth is measured on
// this thread's CPU time with measureGrowth (growth.ts), after a warm-up call of each input; the slowest single call
// must finish within 15 s of CPU time. No wall-clock assertion.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Report = { policy?: { violations: Violation[] } };
interface Core {
  parseSettingsJson(text: string, options: { jsonc: boolean }): { ok: boolean };
  check(input: unknown): Report;
}

const REPO_ROOT = "/home/runner/work/demo/demo";

async function growthOf(label: string, small: () => unknown, large: () => unknown) {
  let slowest = 0;
  const timedCall = (fn: () => unknown) => () => {
    const start = threadCpuMs();
    fn();
    slowest = Math.max(slowest, threadCpuMs() - start);
  };
  const growth = await measureGrowth(timedCall(small), timedCall(large));
  expect(slowest, `${label}: the slowest call finishes within 15 s of CPU time`).toBeLessThan(15_000);
  expect(growth.ratio, `${label} growth: ${growth.detail}`).toBeLessThan(8);
}

const allowFile = (n: number) => {
  const rules = Array.from({ length: n }, (_, i) => `Bash(cmd${i} --flag value${i})`);
  rules.push("Bash(curl x)");
  return `${JSON.stringify({ permissions: { allow: rules } }, null, 2)}\n`;
};
const mcpFile = (n: number) => {
  const servers: Record<string, unknown> = {};
  for (let i = 0; i < n; i++)
    servers[`srv${i}`] = { command: "node", args: [`s${i}.js`], url: `https://h${i}.example/m` };
  servers.evil = { command: "node" };
  return `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
};

describe("policy settings grow close to linearly", { timeout: 300_000 }, () => {
  it("AC-23: parseSettingsJson, P02 and P05 at 4n take less than 8 times as long as at n, each call within 15 s of CPU time", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    expect(typeof core.parseSettingsJson, "parseSettingsJson is exported").toBe("function");

    // The parser.
    const smallText = allowFile(4000);
    const largeText = allowFile(16_000);
    for (const text of [smallText, largeText]) expect(core.parseSettingsJson(text, { jsonc: false }).ok).toBe(true);
    await growthOf(
      "parseSettingsJson",
      () => core.parseSettingsJson(smallText, { jsonc: false }),
      () => core.parseSettingsJson(largeText, { jsonc: false }),
    );

    const coverage = fixture("golden/coverage.info");
    const diff = fixture("diff/empty.diff");
    const checkWith = (document: unknown, path: string, text: string) => () =>
      core.check({
        version: "0.1.0",
        coverage: { text: coverage, format: "lcov" },
        diff: { text: diff },
        repoRoot: REPO_ROOT,
        threshold: null,
        repoFiles: ["AGENTS.md", path],
        policy: { source: "file", version: null, path: "policy/org.json", document },
        policySettingsSources: { files: [{ path, text }], dropped: [] },
      });
    const expectRule = (report: Report, id: string, label: string) =>
      expect(
        (report.policy?.violations ?? []).some((v) => v.id === id),
        `${label}: the warm-up call finds the planted ${id} violation`,
      ).toBe(true);

    // P02 against a fixed forbidden list.
    const forbidden = {
      version: 1,
      setup: { forbidden_permissions: ["Bash(curl:*)", "Bash(rm -rf:*)", "WebFetch", "Read(.env)", "Edit(//etc/**)"] },
    };
    const p02Small = checkWith(forbidden, ".claude/settings.json", allowFile(1000));
    const p02Large = checkWith(forbidden, ".claude/settings.json", allowFile(4000));
    expectRule(p02Small(), "P02", "P02 small");
    expectRule(p02Large(), "P02", "P02 large");
    await growthOf("P02", p02Small, p02Large);

    // P05 against a fixed forbidden list.
    const forbiddenMcp = {
      version: 1,
      setup: { forbidden_mcp_servers: ["*/curl", "npx -y bad*", "evil", "https://bad.*"] },
    };
    const p05Small = checkWith(forbiddenMcp, ".mcp.json", mcpFile(1000));
    const p05Large = checkWith(forbiddenMcp, ".mcp.json", mcpFile(4000));
    expectRule(p05Small(), "P05", "P05 small");
    expectRule(p05Large(), "P05", "P05 large");
    await growthOf("P05", p05Small, p05Large);
  });
});
