import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings), AC-25. check() is loaded inside the test body: the AC test is written before the build
// adds the settings rules, so nothing the build adds may run while this file loads. The base is main at 93376a9
// (E3 item 22 merged), read with git.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const BASE = "93376a9";
const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const atBase = (path: string) =>
  execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const CODES = ["POLICY_P02", "POLICY_P03", "POLICY_P04", "POLICY_P05", "POLICY_P06", "POLICY_SETTINGS_INVALID"];

const DOCUMENT = {
  version: 1,
  setup: {
    forbidden_permissions: ["Bash(curl:*)"],
    required_permissions_deny: ["Bash(rm -rf:*)"],
    allowed_mcp_servers: ["github"],
    forbidden_mcp_servers: ["evil"],
    required_hooks: [{ event: "Stop" }],
  },
};
const SETTINGS = [
  "{",
  '  "permissions": {',
  '    "allow": ["Bash(curl:*)", "Bash(a:*b)"],',
  '    "defaultMode": "bypassPermissions"',
  "  },",
  '  "enableAllProjectMcpServers": true',
  "}",
  "",
].join("\n");
const MCP = '{\n  "mcpServers": {\n    "notes": { "command": "node" },\n    "evil": { "command": "node" }\n  }\n}\n';

describe("report v2 with the P02–P06 violations and the six codes", { timeout: 60_000 }, () => {
  it("AC-25: a report with P02–P06 violations on lines and each new code validates against schema/report.v2.json, the codes are MessageCode members, and report.v1.json is unchanged", async () => {
    const { check } = await import("@pharn-ci/core");
    const run = (sources: unknown) => {
      const report = check({
        version: "0.1.0",
        coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
        diff: { text: fixture("golden/pr.diff") },
        repoRoot: "/home/runner/work/demo/demo",
        threshold: 80,
        repoFiles: [...fixture("golden/files.txt").trim().split("\n"), ".claude/settings.json", ".mcp.json"],
        policy: { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: DOCUMENT },
        policySettingsSources: sources,
      } as never) as unknown as Report;
      expectValidReport(report);
      return report;
    };

    const report = run({
      files: [
        { path: ".claude/settings.json", text: SETTINGS },
        { path: ".mcp.json", text: MCP },
      ],
      dropped: [],
    });
    const violations = report.policy?.violations ?? [];
    for (const id of ["P02", "P04", "P05"]) {
      expect(
        violations.some((v) => v.id === id && typeof v.line === "number"),
        `a ${id} violation with a line`,
      ).toBe(true);
    }
    for (const id of ["P03", "P06"])
      expect(
        violations.some((v) => v.id === id),
        `a ${id} violation`,
      ).toBe(true);
    expect([...new Set(report.messages.map((m) => m.code).filter((c) => CODES.includes(c)))].sort()).toEqual(CODES);

    const unavailable = run({ unavailable: "git ls-tree failed" });
    expect(unavailable.messages.filter((m) => m.code === "POLICY_SETTINGS_INVALID")).toHaveLength(1);

    // The six codes are members of the MessageCode union.
    const source = read("packages/core/src/report.ts");
    const start = source.indexOf("export type MessageCode");
    expect(start).toBeGreaterThan(-1);
    const union = source.slice(start, source.indexOf(";", start));
    for (const code of CODES) expect(union, `MessageCode has ${code}`).toContain(`"${code}"`);

    // The v2 description names them; v1 is byte-identical to the base.
    const v2 = JSON.parse(read("schema/report.v2.json"));
    const description = JSON.stringify(v2);
    for (const code of CODES) expect(description, `report.v2.json names ${code}`).toContain(code);
    expect(read("schema/report.v1.json") === atBase("schema/report.v1.json"), "report.v1.json is unchanged").toBe(true);
  });
});
