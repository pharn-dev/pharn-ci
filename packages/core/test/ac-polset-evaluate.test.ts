import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// E3 item 23 (policy settings), AC-20. evaluatePolicyRules() and the cap constants are loaded inside the test body,
// and item 22's fixtures/policy-rules/ are read there too: the AC test is written before the build extends the rules,
// so nothing the build adds may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Evaluation = { violations: Violation[]; omitted: Record<string, number>; lowered: string[] };
interface Core {
  evaluatePolicyRules(input: unknown): Evaluation;
  parseUnifiedDiff(text: string): unknown[];
  MAX_RULE_VIOLATIONS: number;
  MAX_P08_VIOLATIONS: number;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** By id, then path (null first), then line (null first, ascending), then detail, in code-unit order. */
const order = (a: Violation, b: Violation) =>
  cmp(a.id, b.id) ||
  (a.path === b.path ? 0 : a.path === null ? -1 : b.path === null ? 1 : cmp(a.path, b.path)) ||
  (a.line === b.line ? 0 : a.line === null ? -1 : b.line === null ? 1 : a.line - b.line) ||
  cmp(a.detail, b.detail);

const FILE = (document: unknown) => ({ source: "file", version: null, path: "policy/org.json", document });
const allowFile = (rules: string[]) =>
  `{\n  "permissions": {\n    "allow": [\n${rules.map((r) => `      ${JSON.stringify(r)}`).join(",\n")}\n    ]\n  }\n}\n`;

describe("evaluatePolicyRules: lines, order and the per-rule cap", { timeout: 60_000 }, () => {
  it("AC-20: every violation has a line (null for P01, P08, P09, P10), the order is id, path, line, detail, both caps are 50 and every rule id is capped, and P08 is unchanged", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    expect(core.MAX_RULE_VIOLATIONS).toBe(50);
    expect(core.MAX_P08_VIOLATIONS).toBe(50);

    const base = {
      agentSetupFileCount: 0,
      agentTools: [],
      configPath: null,
      ignored: [],
    };

    // P01, P08, P09 and P02/P03 together. The root file's two P02 violations differ in line and in detail, in
    // opposite orders: the line decides.
    const document = {
      version: 1,
      setup: {
        ...JSON.parse(fixture("policy-rules/p01-violates/policy.json")).setup,
        ...JSON.parse(fixture("policy-rules/p08-violates/policy.json")).setup,
        forbidden_permissions: ["Bash(rm:*)", "Bash(zz)", "Bash(aa)"],
        required_permissions_deny: ["Bash(rm -rf:*)"],
      },
    };
    const mixed = core.evaluatePolicyRules({
      ...base,
      policy: FILE(document),
      repoFiles: fixture("policy-rules/p08-violates/files.txt").trim().split("\n"),
      diff: core.parseUnifiedDiff(fixture("policy-rules/p09-violates/pr.diff")),
      settingsSources: {
        files: [
          { path: ".claude/settings.json", text: allowFile(["Bash(zz)", "Bash(aa)"]) },
          { path: "pkg/.claude/settings.json", text: allowFile(["Bash(rm x)"]) },
        ],
        dropped: [],
      },
    });
    const unavailable = core.evaluatePolicyRules({
      ...base,
      policy: JSON.parse(fixture("policy-rules/p10-violates/resolved.json")),
      repoFiles: ["src/a.ts"],
      diff: null,
    });
    const all = [...mixed.violations, ...unavailable.violations];
    for (const id of ["P01", "P02", "P03", "P08", "P09", "P10"]) {
      expect(
        all.some((v) => v.id === id),
        `control: a ${id} violation`,
      ).toBe(true);
    }
    for (const v of all) {
      expect(Object.hasOwn(v, "line"), `${v.id} ${v.path}: has a line`).toBe(true);
      if (["P01", "P08", "P09", "P10"].includes(v.id)) expect(v.line, `${v.id} ${v.path}: line null`).toBeNull();
    }
    expect(mixed.violations).toEqual([...mixed.violations].sort(order));
    const rootP02 = mixed.violations.filter((v) => v.id === "P02" && v.path === ".claude/settings.json");
    expect(rootP02.map((v) => [v.line, v.detail])).toEqual([
      [4, "allow rule overlaps forbidden permission Bash(zz)"],
      [5, "allow rule overlaps forbidden permission Bash(aa)"],
    ]);
    expect(mixed.violations.map((v) => v.id)).toEqual([...mixed.violations.map((v) => v.id)].sort(cmp));

    // P08 for item 22's input is what it was.
    expect(mixed.violations.filter((v) => v.id === "P08")).toEqual([
      {
        id: "P08",
        severity: "block",
        path: "CLAUDE.local.md",
        line: null,
        detail: "tracked file matches forbidden pattern CLAUDE.local.md",
      },
    ]);

    // Every rule id is capped at 50: 60 P08 matches, 60 P02 allow entries and 55 unlisted MCP servers.
    const files = Array.from({ length: 60 }, (_, i) => `gen/f${String(i).padStart(2, "0")}.tmp`);
    const servers = Array.from({ length: 55 }, (_, i) => `    "s${String(i).padStart(2, "0")}": { "command": "node" }`);
    const capped = core.evaluatePolicyRules({
      ...base,
      agentSetupFileCount: 1,
      policy: FILE({
        version: 1,
        setup: {
          forbidden_files: ["gen/*.tmp"],
          forbidden_permissions: ["Bash(curl:*)"],
          allowed_mcp_servers: ["github"],
        },
      }),
      repoFiles: [...files].reverse(),
      diff: [],
      settingsSources: {
        files: [
          { path: ".claude/settings.json", text: allowFile(Array.from({ length: 60 }, (_, i) => `Bash(curl n${i})`)) },
          { path: ".mcp.json", text: `{\n  "mcpServers": {\n${servers.join(",\n")}\n  }\n}\n` },
        ],
        dropped: [],
      },
    });
    const count = (id: string) => capped.violations.filter((v) => v.id === id).length;
    expect([count("P02"), count("P04"), count("P08")]).toEqual([50, 50, 50]);
    expect(capped.omitted).toEqual({ P02: 10, P04: 5, P08: 10 });
    expect(capped.violations.filter((v) => v.id === "P02").map((v) => v.line)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 4),
    );
    expect(capped.violations.filter((v) => v.id === "P08")).toEqual(
      files.slice(0, 50).map((path) => ({
        id: "P08",
        severity: "block",
        path,
        line: null,
        detail: "tracked file matches forbidden pattern gen/*.tmp",
      })),
    );
    expect(capped.violations).toEqual([...capped.violations].sort(order));
  });
});
