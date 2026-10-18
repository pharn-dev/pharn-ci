import { describe, expect, it } from "vitest";
import { expectValidReport } from "./schema.js";

// AC test for pr-comment-redesign-2 (AC-3). Targets are imported inside the test body so the file loads before
// the build; one `it` for the AC. No snapshot: the expected values are written inline.

type Block = { open: number; close: number };

/** Each `<details>` line paired with the next `</details>` line at or after it. */
function detailsBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.includes("<details>") && !line.includes("<details open>")) continue;
    const close = lines.findIndex((l, j) => j >= i && l.includes("</details>"));
    expect(close, `<details> at line ${i} is closed`).toBeGreaterThanOrEqual(i);
    blocks.push({ open: i, close });
  }
  return blocks;
}

/** First and last index of the table lines (`|`-led) between two line indexes. */
function tableSpan(lines: string[], from: number, to: number): { first: number; last: number } {
  const rows = lines.map((l, i) => (i > from && i < to && l.startsWith("|") ? i : -1)).filter((i) => i >= 0);
  expect(rows.length).toBeGreaterThan(0);
  return { first: rows[0] ?? -1, last: rows[rows.length - 1] ?? -1 };
}

/** The `<details>` block holding the whole table, if any. */
function enclosing(blocks: Block[], span: { first: number; last: number }): Block | undefined {
  return blocks.find((b) => b.open < span.first && b.close > span.last);
}

function sections(md: string) {
  const lines = md.split("\n");
  const heading = lines.findIndex((l) => l.trim() !== "");
  const diff = lines.indexOf("### 🧪 Diff coverage");
  const messages = lines.findIndex((l) => l.startsWith("### 💬 Messages ("));
  const setup = lines.findIndex((l) => l.startsWith("### 🤖 Agent setup ("));
  return { lines, heading, diff, messages, setup };
}

describe("PR comment look: section order and collapsed long tables (pr-comment-redesign-2)", () => {
  it("AC-3: keeps the section order, collapses the file tables at 30 and at 25 files, and never collapses messages", async () => {
    const { buildReport } = await import("../src/report.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const changed = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        path: `src/f${String(i + 1).padStart(2, "0")}.ts`,
        percent: 50,
        coveredLines: 1,
        coverableLines: 2,
        uncoveredLines: [2],
      }));
    const skills = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        path: `.claude/skills/s${String(i + 1).padStart(2, "0")}/SKILL.md`,
        kind: "claude-skill",
      }));
    const reportOf = (n: number) =>
      buildReport({
        version: "0.1.0",
        threshold: 80,
        diffCoverage: {
          percent: 50,
          threshold: 80,
          coveredLines: n,
          coverableLines: 2 * n,
          files: changed(n),
          meetsThreshold: false,
        },
        agentSetup: { files: skills(n) as never },
      });

    // 30 files of each kind.
    const report30 = reportOf(30);
    expectValidReport(report30);
    expect(report30.messages.length).toBeGreaterThan(0);
    const s = sections(renderMarkdown(report30));
    const { lines } = s;

    // Order: verdict header, summary block, Diff coverage, Messages, Agent setup.
    expect(lines[s.heading]).toBe("## 🛡️ pharn-ci · ❌ Fail");
    expect(s.diff).toBeGreaterThan(s.heading);
    const summary = lines.slice(s.heading + 1, s.diff).filter((l) => l.trim() !== "");
    expect(summary.length, "summary block between the header and Diff coverage").toBeGreaterThan(0);
    expect(s.messages).toBeGreaterThan(s.diff);
    expect(s.setup).toBeGreaterThan(s.messages);

    const blocks = detailsBlocks(lines);
    const diffTable = tableSpan(lines, s.diff, s.messages);
    const setupTable = tableSpan(lines, s.setup, lines.length);
    for (const [name, span] of [
      ["diff coverage table", diffTable],
      ["agent setup table", setupTable],
    ] as const) {
      const block = enclosing(blocks, span);
      expect(block, `${name} sits inside <details>`).toBeDefined();
      const summaryLine = lines.slice(block?.open ?? 0, span.first).find((l) => l.includes("<summary>"));
      expect(summaryLine, `${name} has a <summary>`).toBeDefined();
      expect(summaryLine, `${name} <summary> names the count`).toMatch(/(^|[^\d])30([^\d]|$)/);
    }

    // No message line sits inside a <details> block.
    const messageLines = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l, i }) => i > s.messages && i < s.setup && l.trim() !== "");
    expect(messageLines.length).toBeGreaterThan(0);
    for (const { l, i } of messageLines) {
      expect(
        blocks.some((b) => b.open <= i && i <= b.close),
        `message line inside <details>: ${l}`,
      ).toBe(false);
    }

    // 25 files of each kind: both tables are inside a <details> block whose <summary> names 25.
    const report25 = reportOf(25);
    expectValidReport(report25);
    const t = sections(renderMarkdown(report25));
    const blocks25 = detailsBlocks(t.lines);
    for (const [name, span] of [
      ["25-file diff coverage table", tableSpan(t.lines, t.diff, t.messages)],
      ["25-file agent setup table", tableSpan(t.lines, t.setup, t.lines.length)],
    ] as const) {
      const block = enclosing(blocks25, span);
      expect(block, `${name} sits inside <details>`).toBeDefined();
      const summaryLine = t.lines.slice(block?.open ?? 0, span.first).find((l) => l.includes("<summary>"));
      expect(summaryLine, `${name} <summary> names the count`).toMatch(/(^|[^\d])25([^\d]|$)/);
    }
  });
});
