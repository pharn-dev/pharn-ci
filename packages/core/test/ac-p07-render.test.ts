import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24 (P07), AC-15. renderMarkdown() is loaded inside the test body and fixtures/policy-rules/p07/render/ is
// read there too: the AC test is written before the build adds the POLICY_P07 hint and the golden, so nothing the
// build adds may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = Record<string, unknown> & { messages: Message[]; policy?: { violations: Violation[] } };

interface Core {
  renderMarkdown(report: Report): string;
}

const HOSTILE = "packages/we`ird<!--|x/AGENTS.md";
const P07_HINT =
  "Make the instruction files in one directory name the same package manager and test runner, or move a file into the package it describes; an agent follows whichever file it reads first.";
const AGENTS_LINE = "- ⚠️ **P07** `AGENTS.md:3` — package manager: pnpm here, npm in CLAUDE.md:4";

/** The lines of a `### ` section whose heading starts with `heading`, up to the next `### ` heading; [] when absent. */
function section(md: string, heading: string): string[] {
  const lines = md.split("\n");
  const at = lines.findIndex((l) => l.startsWith(heading));
  if (at === -1) return [];
  const next = lines.findIndex((l, i) => i > at && l.startsWith("### "));
  return lines.slice(at, next === -1 ? undefined : next);
}

/** A line as GitHub renders it outside code spans and backslash escapes. */
const live = (line: string) => line.replace(/(`+)[\s\S]*?\1/g, "").replace(/\\[\s\S]/g, "");

describe("the P07 violations and message in the PR comment", { timeout: 60_000 }, () => {
  it("AC-15: the rendered report equals the golden; the Policy section lists the AGENTS.md:3 line with the POLICY_P07 hint and a path-less P07 line; Messages holds no POLICY_P07 text; the hostile path stays in one code span on one line", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const report = JSON.parse(fixture("policy-rules/p07/render/report.json")) as Report;
    expectValidReport(report);

    // The input report holds what the golden is meant to show.
    const p07 = (report.policy?.violations ?? []).filter((v) => v.id === "P07");
    expect(p07.map((v) => v.path)).toEqual(expect.arrayContaining(["AGENTS.md", "CLAUDE.md", HOSTILE, null]));
    expect(p07.find((v) => v.path === "AGENTS.md")?.line).toBe(3);
    expect(p07.find((v) => v.path === "CLAUDE.md")?.line).toBe(4);
    const p07Text = report.messages.find((m) => m.code === "POLICY_P07")?.text ?? "";
    expect(p07Text.length).toBeGreaterThan(0);

    const markdown = core.renderMarkdown(report);
    expect(markdown).toBe(fixture("policy-rules/p07/render/report.md"));

    const policy = section(markdown, "### 📜 Policy");
    expect(policy.length, "a Policy section").toBeGreaterThan(0);
    const agents = policy.indexOf(AGENTS_LINE);
    expect(agents, AGENTS_LINE).toBeGreaterThanOrEqual(0);
    expect(policy[agents + 1]).toBe(`  - Hint: ${P07_HINT}`);
    expect(policy.some((l) => l.startsWith("- ⚠️ **P07** — "))).toBe(true);

    // The renderer may backslash-escape message text; compare with the escapes taken out.
    const messages = section(markdown, "### 💬 Messages").join("\n").replace(/\\/g, "");
    expect(messages).not.toContain(p07Text);
    expect(messages).not.toContain("agent instruction file");

    // The hostile path renders on one line, inside one code span, inert outside it.
    const hostile = markdown.split("\n").filter((l) => l.includes("ird") && l.includes("x/AGENTS.md"));
    expect(hostile.length).toBeGreaterThan(0);
    for (const line of hostile) {
      expect(live(line), line).not.toContain("ird");
      expect(live(line), line).not.toContain("<!--");
    }
    expect(policy.filter((l) => l.includes("ird") && l.includes("x/AGENTS.md"))).toHaveLength(1);
  });
});
