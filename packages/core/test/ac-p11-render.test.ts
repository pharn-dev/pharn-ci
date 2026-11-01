import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-21. renderMarkdown() is loaded inside the test body and fixtures/policy-rules/p11/render/
// is read there too: the AC test is written before the build adds rule P11 and its golden, so nothing the build adds
// may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = Record<string, unknown> & { messages: Message[]; policy?: { violations: Violation[] } };

interface Core {
  renderMarkdown(report: Report): string;
}

const HOSTILE = "src/we`ird<!--|x.ts";
const P11_HINT =
  "Agent PRs may not change these paths under the org policy. Move the change to a pull request by a person, or ask the policy owner to change `agents.protected_paths`.";
const INCOMPLETE_HINT =
  "Re-run the job if the GitHub API failed. A pull request with more than 250 commits, an author GitHub does not name, or an edited policy file whose base cannot be read always counts as an agent PR.";

/** The lines of a `### ` section whose heading starts with `heading`, up to the next `### ` heading. */
function section(md: string, heading: string): string[] {
  const lines = md.split("\n");
  const at = lines.findIndex((l) => l.startsWith(heading));
  expect(at, heading).toBeGreaterThanOrEqual(0);
  const next = lines.findIndex((l, i) => i > at && l.startsWith("### "));
  return lines.slice(at, next === -1 ? undefined : next);
}

/** A line as GitHub renders it outside code spans and backslash escapes. */
const live = (line: string) => line.replace(/(`+)[\s\S]*?\1/g, "").replace(/\\[\s\S]/g, "");

describe("the P11 violations and messages in the PR comment", { timeout: 60_000 }, () => {
  it("AC-21: the rendered report equals the golden; the Policy section lists the P11 path line and a path-less P11 line with the POLICY_P11 hint; Messages holds the incomplete message and hint but no POLICY_P11 text; the hostile path stays in one code span", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const report = JSON.parse(fixture("policy-rules/p11/render/report.json")) as Report;
    expectValidReport(report);

    // The input report holds what the golden is meant to show.
    const p11 = (report.policy?.violations ?? []).filter((v) => v.id === "P11");
    expect(p11.map((v) => v.path)).toEqual(expect.arrayContaining([".github/workflows/ci.yml", HOSTILE, null]));
    const codes = report.messages.map((m) => m.code);
    expect(codes).toContain("POLICY_P11");
    const incomplete = report.messages.find((m) => m.code === "AGENT_PR_DETECTION_INCOMPLETE");
    expect(incomplete?.text).toContain("commits-unreadable");

    const markdown = core.renderMarkdown(report);
    expect(markdown).toBe(fixture("policy-rules/p11/render/report.md"));

    const policy = section(markdown, "### 📜 Policy");
    expect(policy).toContain("- ❌ **P11** `.github/workflows/ci.yml` — agent PR changes a protected path");
    const pathless = policy.findIndex((l) => l.startsWith("- ❌ **P11** — "));
    expect(pathless, "a path-less P11 line").toBeGreaterThanOrEqual(0);
    expect(policy[pathless + 1]).toBe(`  - Hint: ${P11_HINT}`);

    // The renderer may backslash-escape message text; compare with the escapes taken out.
    const messages = section(markdown, "### 💬 Messages (").join("\n").replace(/\\/g, "");
    const p11Text = report.messages.find((m) => m.code === "POLICY_P11")?.text ?? "";
    expect(p11Text.length).toBeGreaterThan(0);
    expect(messages).not.toContain("This agent pull request");
    expect(messages).not.toContain(p11Text);
    expect(messages).toContain(incomplete?.text ?? "");
    expect(messages).toContain(`Hint: ${INCOMPLETE_HINT}`);

    // The hostile path renders on one line, inside one code span, inert outside it.
    const hostile = markdown.split("\n").filter((l) => l.includes("ird") && l.includes("x.ts"));
    expect(hostile.length).toBeGreaterThan(0);
    for (const line of hostile) {
      expect(live(line), line).not.toContain("ird");
      expect(live(line), line).not.toContain("<!--");
    }
    expect(policy.filter((l) => l.includes("ird") && l.includes("x.ts"))).toHaveLength(1);
  });
});
