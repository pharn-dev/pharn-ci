import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings), AC-22. check() is loaded inside the test body, and item 22's gates.diff is read there:
// the AC test is written before the build gives P09 class 4 its final levels, so nothing the build adds may run while
// this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
type Drop = { path: string; reason: string };

const REPO_ROOT = "/home/runner/work/demo/demo";

const modify = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,3 +1,3 @@",
    " {",
    '-  "theme": "light"',
    '+  "theme": "dark"',
    " }",
  ].join("\n");
const remove = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    "deleted file mode 100644",
    "index 1111111..0000000",
    `--- a/${path}`,
    "+++ /dev/null",
    "@@ -1,3 +0,0 @@",
    "-{",
    '-  "theme": "light"',
    "-}",
  ].join("\n");
const diffOf = (...parts: string[]) => `${parts.join("\n")}\n`;

async function run(input: {
  document: unknown;
  diff: string;
  files?: Record<string, string>;
  dropped?: Drop[];
  sources?: boolean;
}): Promise<Report> {
  const files = input.files ?? {};
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: input.diff },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "policy/org.json", "src/a.ts", ...Object.keys(files)],
    policy: { source: "file", version: null, path: "policy/org.json", document: input.document },
    ...(input.sources === false
      ? {}
      : {
          policySettingsSources: {
            files: Object.entries(files).map(([path, text]) => ({ path, text })),
            dropped: input.dropped ?? [],
          },
        }),
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const p09 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P09");
const finding = (severity: string, path: string, detail: string): Violation => ({
  id: "P09",
  severity,
  path,
  line: null,
  detail,
});
const FAILS = "this change edits a file that fails ";
const UNCHECKED = "this change edits a file the policy could not check";
const SUPPLIES = "this change edits a file that supplies a required deny rule or hook; a reviewer should confirm it";
const COMPLIES = "this change edits a file the policy checks; it complies";
const settings = (permissions: unknown) => `${JSON.stringify({ permissions }, null, 2)}\n`;

describe("org policy rule P09: class 4 at its final level", { timeout: 60_000 }, () => {
  it("AC-22: an edited settings or MCP file is a block when it fails a rule or could not be checked, a warn when it only warns or supplies a requirement, info when it complies; backup files are out and nested .mcp.json is in", async () => {
    const forbid = { version: 1, setup: { forbidden_permissions: ["Bash(curl:*)"] } };
    const first = await run({
      document: forbid,
      diff: diffOf(
        modify("a/.claude/settings.json"),
        modify("b/.claude/settings.json"),
        modify("c/.claude/settings.json"),
        modify("d/.claude/settings.json"),
        modify(".claude/settings.backup.json"),
        modify("pkg/.mcp.json"),
      ),
      files: {
        "a/.claude/settings.json": settings({ allow: ["Bash(curl:*)"] }),
        "b/.claude/settings.json": settings({ additionalDirectories: ["../shared"] }),
        "d/.claude/settings.json": settings({ allow: ["Bash(ls)"] }),
      },
      dropped: [{ path: "c/.claude/settings.json", reason: "too-large" }],
    });
    expect(p09(first)).toEqual([
      finding("block", "a/.claude/settings.json", `${FAILS}P02`),
      finding("warn", "b/.claude/settings.json", `${FAILS}P02`),
      finding("block", "c/.claude/settings.json", UNCHECKED),
      finding("info", "d/.claude/settings.json", COMPLIES),
      finding("info", "pkg/.mcp.json", COMPLIES),
    ]);

    const second = await run({
      document: { version: 1, setup: { required_permissions_deny: ["Bash(rm -rf:*)"] } },
      diff: diffOf(remove(".claude/settings.json"), modify("s/.claude/settings.json")),
      files: { "s/.claude/settings.json": settings({ deny: ["Bash"] }) },
    });
    expect(p09(second)).toEqual([
      finding("block", ".claude/settings.json", `${FAILS}P03`),
      finding("warn", "s/.claude/settings.json", SUPPLIES),
    ]);

    // No setup list at all: the fixed defaultMode check still makes the edit a block.
    const third = await run({
      document: { version: 1 },
      diff: diffOf(modify(".claude/settings.json")),
      files: { ".claude/settings.json": settings({ defaultMode: "bypassPermissions" }) },
    });
    expect(p09(third)).toEqual([finding("block", ".claude/settings.json", `${FAILS}P02`)]);

    // Classes 1–3 are unchanged: item 22's gates.diff gives the same P09 findings with and without sources.
    const gates = fixture("policy-rules/p09-violates/gates.diff");
    const without = p09(await run({ document: forbid, diff: gates, sources: false }));
    const withSources = p09(await run({ document: forbid, diff: gates }));
    expect(without).toContainEqual(
      finding("block", "policy/org.json", "this change edits the policy file it is checked against"),
    );
    expect(withSources).toEqual(without);
  });
});
