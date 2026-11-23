import { describe, expect, it } from "vitest";
import type { Message, MessageCode, ReportPolicyViolation as Violation } from "../src/report.js";
import { fixture } from "./helpers.js";

// E3 item 23 (policy settings), AC-24. check() and renderMarkdown() are loaded inside the test body, and the golden
// fixtures/policy-settings/render/policy-section.md is read there too: the AC test is written before the build adds
// the Settings line, the hints and the golden. The structural lines are asserted here as well, so the golden alone
// cannot satisfy the test.

const HOSTILE = "x`y|<b>z</b>*w*/.claude/settings.json";
const v = (id: string, severity: Violation["severity"], path: string, line: number, detail: string): Violation => ({
  id,
  severity,
  path,
  line,
  detail,
});
const V: Violation[] = [
  v("P02", "block", ".claude/settings.json", 3, "allow rule overlaps forbidden permission Bash(curl:*)"),
  v("P02", "block", ".claude/settings.json", 4, "allow rule overlaps forbidden permission Bash(rm -rf:*) and 2 more"),
  v("P02", "block", ".claude/settings.json", 9, "defaultMode bypassPermissions turns permission prompts off"),
  v(
    "P02",
    "warn",
    ".claude/settings.json",
    11,
    "additionalDirectories gives the agent file access outside the repository",
  ),
  v("P02", "block", HOSTILE, 5, "allow rule overlaps forbidden permission WebFetch"),
  v("P04", "block", ".claude/settings.json", 14, "enableAllProjectMcpServers approves every project MCP server"),
  v("P04", "block", ".mcp.json", 2, "MCP server is not on the policy's allowlist"),
  v("P04", "block", ".mcp.json", 7, "MCP server is not on the policy's allowlist"),
  v("P05", "block", ".cursor/mcp.json", 3, "MCP server matches forbidden entry */curl"),
  v("P05", "block", ".cursor/mcp.json", 8, "MCP server matches forbidden entry evil and 2 more"),
  v("P05", "block", "pkg/.mcp.json", 2, "MCP server matches forbidden entry https://bad.example/*"),
  v("P06", "block", ".claude/settings.json", 16, "disableAllHooks turns every hook off"),
];
const SETTINGS_TEXT =
  "P02–P06 could not fully use these agent settings files: `.claude/settings.json` line 6 (`unknown-rule-syntax`). Claude Code skips an unparseable file or entry; pharn-ci never guesses what it meant, and a file it could not read counts against the policy.";
const SETTINGS: Message = { level: "warn", code: "POLICY_SETTINGS_INVALID", text: SETTINGS_TEXT };
const IGNORED: Message = {
  level: "warn",
  code: "POLICY_OVERRIDE_IGNORED",
  text: "The policy file sets policy.rules.P02 lower than the default, so it was not applied.",
};
// CORE-140: the hints are each code's fix.hint; P02 to P06 share one.
const REVIEW_POLICY = "Ask a maintainer or the policy owner to review the committed agent settings this rule names.";
const HINTS: Record<string, string> = {
  P02: REVIEW_POLICY,
  P04: REVIEW_POLICY,
  P05: REVIEW_POLICY,
  P06: REVIEW_POLICY,
};
const INVALID_HINT = "Check the policy settings and correct the ones the report names.";

/** The section from `### 📜 Policy` up to and including the newline before the next `### ` line. */
function policySection(markdown: string): string {
  const start = markdown.indexOf("### 📜 Policy");
  expect(start, "a Policy section").toBeGreaterThan(-1);
  const next = markdown.indexOf("\n### ", start + 1);
  return next === -1 ? markdown.slice(start) : markdown.slice(start, next + 1);
}

/**
 * The violation line the renderer prints: the id, `path:line` in one code span, and the detail as one line of inline
 * text (HTML, markdown, mentions and autolinks neutralized, as item 22's renderer does).
 */
const escapeDetail = (detail: string) =>
  detail
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]#!|~]/g, "\\$&")
    .replace(/@/g, "@​")
    .replace(/:\/\//g, ":\\/\\/")
    .replace(/(www)\./gi, "$1\\.");
const codeSpan = (text: string) => `\`${text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/`/g, "'")}\``;
const icon = (severity: string) => (severity === "block" ? "❌" : "⚠️");
const lineOf = (x: Violation) =>
  `- ${icon(x.severity)} **${x.id}** ${codeSpan(`${x.path}:${x.line}`)} — ${escapeDetail(x.detail)}`;

describe("the Policy section with P02–P06 and the Settings line", { timeout: 60_000 }, () => {
  it("AC-24: each violation as path:line with its hint, past 10 folded, the Settings line and hint before Ignored, the new codes out of Messages, the hostile path escaped, equal to the golden; no policy renders as before", async () => {
    const core = {
      ...(await import("@pharn-ci/core")),
      check: (await import("./text-coverage.js")).check,
    };
    const base = core.check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    expect(core.renderMarkdown(base), "a report with no policy object renders as before").toBe(
      fixture("golden/report.md"),
    );

    const report = {
      ...base,
      policy: { source: "input" as const, version: null, violations: V },
      messages: [...base.messages, SETTINGS, IGNORED],
    };
    const markdown = core.renderMarkdown(report);
    const section = policySection(markdown);
    const lines = section.split("\n");

    // Blocks first, in report order; the first 10 open, the other 2 in <details>.
    const blocks = V.filter((x) => x.severity === "block");
    const ordered = [...blocks, ...V.filter((x) => x.severity !== "block")];
    const positions = ordered.map((x) => {
      const at = lines.indexOf(lineOf(x));
      expect(at, `the line for ${x.id} ${x.path}:${x.line}`).toBeGreaterThan(-1);
      expect(lines[at + 1], `the hint under ${x.id} ${x.path}:${x.line}`).toBe(`  - Hint: ${HINTS[x.id]}`);
      return at;
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    const details = lines.indexOf("<details><summary>2 more violations</summary>");
    expect(details, "the fold").toBeGreaterThan(-1);
    expect(positions.slice(0, 10).every((p) => p < details)).toBe(true);
    expect(positions.slice(10).every((p) => p > details)).toBe(true);

    // The hostile path stays inside one code span.
    expect(section).toContain("`x'y\\|<b>z</b>*w*/.claude/settings.json:5`");
    expect(section.includes(HOSTILE)).toBe(false);

    // The Settings line and its hint, after the violations and before the Ignored line.
    const settingsLine = `- ⚠️ Settings: ${SETTINGS_TEXT.replace(/[\\`]/g, "\\$&")}`;
    const at = lines.indexOf(settingsLine);
    expect(at, "the Settings line").toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe(`  - Hint: ${INVALID_HINT}`);
    expect(at).toBeGreaterThan(Math.max(...positions));
    const ignoredAt = lines.findIndex((l) => l.startsWith("- ⚠️ Ignored: "));
    expect(ignoredAt).toBeGreaterThan(at + 1);

    // The Messages section leaves the six codes out.
    const outside = markdown.replace(section, "");
    expect(
      outside.includes("could not fully use these agent settings files"),
      "no settings text outside the section",
    ).toBe(false);
    const withRuleMessages = core.renderMarkdown({
      ...report,
      messages: [
        ...report.messages,
        ...["P02", "P03", "P04", "P05", "P06"].map((id) => ({
          level: "error" as const,
          code: `POLICY_${id}` as MessageCode,
          text: `${id} rule message marker text.`,
        })),
      ],
    });
    for (const id of ["P02", "P03", "P04", "P05", "P06"]) {
      expect(withRuleMessages.includes(`${id} rule message marker text`), `POLICY_${id} is not in Messages`).toBe(
        false,
      );
    }

    // The golden.
    expect(section).toBe(fixture("policy-settings/render/policy-section.md"));

    // The error variant.
    const errorSection = policySection(
      core.renderMarkdown({ ...report, messages: [...base.messages, { ...SETTINGS, level: "error" }, IGNORED] }),
    );
    expect(errorSection.split("\n")).toContain(`- ❌ Settings: ${SETTINGS_TEXT.replace(/[\\`]/g, "\\$&")}`);
    expect(errorSection.includes("- ⚠️ Settings:")).toBe(false);
  });
});
