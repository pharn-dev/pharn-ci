import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings), AC-9. check() is loaded inside the test body: the AC test is written before the build
// adds the settings rules, so nothing the build adds may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";
const DOCUMENT = { version: 1, setup: { required_permissions_deny: ["Bash(rm -rf:*)", "Read(.env)"] } };

async function p03Of(files: Record<string, string>): Promise<Violation[]> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts", ...Object.keys(files)],
    policy: { source: "file", version: null, path: "policy/org.json", document: DOCUMENT },
    policySettingsSources: { files: Object.entries(files).map(([path, text]) => ({ path, text })), dropped: [] },
  } as never);
  expectValidReport(report);
  return ((report as unknown as Report).policy?.violations ?? []).filter((v) => v.id === "P03");
}

const deny = (...rules: string[]) => `${JSON.stringify({ permissions: { deny: rules } }, null, 2)}\n`;
const missing = (path: string, rule: string): Violation => ({
  id: "P03",
  severity: "block",
  path,
  line: null,
  detail: `required deny rule ${rule} is missing`,
});

describe("org policy rule P03: required deny missing, per unit", { timeout: 60_000 }, () => {
  it("AC-9: a deny rule equal or broader satisfies, ./.env does not, units are judged on their own, and the report path falls back to settings.local.json or settings.json", async () => {
    // A bare Bash covers Bash(rm -rf:*); Read(**/.env) is Read(.env).
    expect(await p03Of({ ".claude/settings.json": deny("Bash", "Read(**/.env)") })).toEqual([]);

    // Read(./.env) is the anchor's .env only, so it does not cover Read(.env).
    expect(await p03Of({ ".claude/settings.json": deny("Bash", "Read(./.env)") })).toEqual([
      missing(".claude/settings.json", "Read(.env)"),
    ]);

    // A nested unit that satisfies both does not help the root unit, which has no deny rule.
    expect(
      await p03Of({
        ".claude/settings.json": '{ "permissions": {} }\n',
        "pkg/.claude/settings.json": deny("Bash(rm:*)", "Read(.env)"),
      }),
    ).toEqual([missing(".claude/settings.json", "Bash(rm -rf:*)"), missing(".claude/settings.json", "Read(.env)")]);

    // Only settings.local.json at the root: the findings sit there.
    expect(await p03Of({ ".claude/settings.local.json": deny("Bash(ls)") })).toEqual([
      missing(".claude/settings.local.json", "Bash(rm -rf:*)"),
      missing(".claude/settings.local.json", "Read(.env)"),
    ]);

    // No settings file at all: the root unit still exists.
    expect(await p03Of({})).toEqual([
      missing(".claude/settings.json", "Bash(rm -rf:*)"),
      missing(".claude/settings.json", "Read(.env)"),
    ]);
  });
});
