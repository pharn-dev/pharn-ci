import { describe, expect, it } from "vitest";
import { expectValidReport } from "./schema.js";

// E3 item 22 (policy rules), AC-16. buildReport() and renderMarkdown() are loaded inside the test body: the AC test
// is written before the build adds the Policy section, so nothing the build adds may run while this file loads. The
// report is hand-built: a buildReport() report given a policy object and a POLICY_OVERRIDE_IGNORED message.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = Record<string, unknown> & { messages: Message[] };

interface Core {
  buildReport(input: unknown): Report;
  renderMarkdown(report: Report, options?: { maxRows?: number }): string;
}

const HEADING = "### 📜 Policy";
const HOSTILE = "x|y`z\n<script>alert(1)</script> @user/CLAUDE.local.md";
const P08_DETAIL = "tracked file matches forbidden pattern secret";
const SETTINGS_DETAIL = "this change edits a file the policy checks; its direction is not judged yet";

/** 12 violations in report order: 6 block, 4 warn, 2 info, interleaved. */
const VIOLATIONS: Violation[] = [
  { id: "P10", severity: "warn", path: null, line: null, detail: "org policy could not be read (timeout)" },
  { id: "P01", severity: "block", path: null, line: null, detail: "no agent setup files found" },
  { id: "P01", severity: "info", path: null, line: null, detail: "no setup file for cursor" },
  { id: "P08", severity: "block", path: HOSTILE, line: null, detail: P08_DETAIL },
  { id: "P09", severity: "warn", path: ".mcp.json", line: null, detail: SETTINGS_DETAIL },
  { id: "P08", severity: "block", path: "a1.env", line: null, detail: P08_DETAIL },
  {
    id: "P09",
    severity: "block",
    path: "policy/org.json",
    line: null,
    detail: "this change edits the policy file it is checked against",
  },
  { id: "P08", severity: "block", path: "a2.env", line: null, detail: P08_DETAIL },
  { id: "P09", severity: "warn", path: ".claude/settings.json", line: null, detail: SETTINGS_DETAIL },
  { id: "P08", severity: "block", path: "a3.env", line: null, detail: P08_DETAIL },
  { id: "P01", severity: "warn", path: null, line: null, detail: "no setup file for codex" },
  { id: "P08", severity: "info", path: "a4.env", line: null, detail: P08_DETAIL },
];
/** The report indexes above, block first, then warn, then info, stable. */
const EXPECTED_ORDER = [1, 3, 5, 6, 7, 9, 0, 4, 8, 10, 2, 11];
const ICONS: Record<string, string> = { block: "❌", warn: "⚠️", info: "ℹ️" };

const IGNORED: Message = {
  level: "warn",
  code: "POLICY_OVERRIDE_IGNORED",
  text: "Some settings were looser than the org policy, or are not allowed from a policy file, so the policy's value applies: policy.rules.P01 (policy-file).",
};

/** The lines of the Policy section, from its heading to the next `### ` heading (exclusive). */
function policySection(md: string): string[] {
  const lines = md.split("\n");
  const at = lines.indexOf(HEADING);
  expect(at, "the Policy heading").toBeGreaterThanOrEqual(0);
  const next = lines.findIndex((l, i) => i > at && l.startsWith("### "));
  return lines.slice(at, next === -1 ? undefined : next);
}

const isViolationLine = (line: string) => /^- (❌|⚠️|ℹ️) \*\*P\d\d\*\*/.test(line);
/** A line as GitHub renders it outside code spans and backslash escapes. */
const live = (line: string) => line.replace(/(`+)[\s\S]*?\1/g, "").replace(/\\[\s\S]/g, "");

describe("the Policy section's violation list", { timeout: 60_000 }, () => {
  it("AC-16: 12 mixed violations list blocks first, 10 open and 2 folded, each with a hint line; maxRows 3 lists 3 and counts the rest; a hostile path stays inert; an ignored setting renders its line", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const base = core.buildReport({
      version: "0.1.0",
      threshold: null,
      diffCoverage: {
        percent: 100,
        threshold: null,
        coveredLines: 1,
        coverableLines: 1,
        files: [],
        meetsThreshold: true,
      },
      agentSetup: { files: [{ path: "AGENTS.md", kind: "agents-md" }] },
    });
    const report: Report = {
      ...base,
      messages: [...base.messages, IGNORED],
      policy: { source: "app", version: 3, violations: VIOLATIONS },
    };
    expectValidReport(report);

    const section = policySection(core.renderMarkdown(report));
    const at = section.map((l, i) => (isViolationLine(l) ? i : -1)).filter((i) => i >= 0);
    expect(at).toHaveLength(12);
    const listed = at.map((i) => section[i] ?? "");
    EXPECTED_ORDER.forEach((index, n) => {
      const v = VIOLATIONS[index] as Violation;
      const line = listed[n] ?? "";
      expect(line.startsWith(`- ${ICONS[v.severity]} **${v.id}** `), line).toBe(true);
      // The detail goes through the renderer's inline escaping; these details hold nothing it must escape.
      expect(line.replace(/\\/g, "").endsWith(` — ${v.detail}`), line).toBe(true);
    });
    expect(listed[0]).toBe("- ❌ **P01** — no agent setup files found");
    expect(listed[2]).toContain("a1.env");
    // Every violation line is followed by its hint line; the P08 hint is the fixed POLICY_P08 hint.
    for (const i of at) expect(section[i + 1] ?? "", section[i]).toMatch(/^ {2}- Hint: \S/);
    expect(section[(at[2] ?? 0) + 1]).toBe(
      "  - Hint: Stop tracking the file (`git rm --cached` it and add it to `.gitignore`); the org policy forbids it in the repository.",
    );

    // 10 open, then the last 2 in a details block.
    const details = section.indexOf("<details><summary>2 more violations</summary>");
    expect(details).toBeGreaterThan(at[9] ?? Number.POSITIVE_INFINITY);
    expect(details).toBeLessThan(at[10] ?? -1);
    expect(section.indexOf("</details>")).toBeGreaterThan(at[11] ?? Number.POSITIVE_INFINITY);
    expect(section.join("\n")).not.toContain("more violations in report.json");

    // The hostile path renders on its one line, inert outside code spans.
    const hostileLines = section.filter((l) => l.includes("@user"));
    expect(hostileLines).toHaveLength(1);
    expect((hostileLines[0] ?? "").startsWith("- ❌ **P08** ")).toBe(true);
    for (const line of section) {
      expect(line.startsWith("<script"), line).toBe(false);
      expect(live(line), line).not.toContain("<script");
      expect(live(line), line).not.toMatch(/@user/);
    }

    // The ignored setting renders its own line and hint.
    const ignoredAt = section.findIndex((l) => l.startsWith("- ⚠️ Ignored: "));
    expect(ignoredAt).toBeGreaterThan(at[11] ?? Number.POSITIVE_INFINITY);
    expect(section[ignoredAt]).toContain("policy.rules.P01 (policy-file)");
    expect(section[ignoredAt + 1] ?? "").toMatch(/^ {2}- Hint: \S/);

    // maxRows 3: three listed, then the count of the rest, nothing folded.
    const short = policySection(core.renderMarkdown(report, { maxRows: 3 }));
    const shortListed = short.filter(isViolationLine);
    expect(shortListed).toHaveLength(3);
    expect(shortListed[0]).toBe("- ❌ **P01** — no agent setup files found");
    expect(short).toContain("- _…and 9 more violations in report.json._");
    expect(short.indexOf("- _…and 9 more violations in report.json._")).toBeGreaterThan(
      short.indexOf(shortListed[2] ?? ""),
    );
    expect(short.join("\n")).not.toContain("<details><summary>");
  });
});
