import { describe, expect, it } from "vitest";
import { buildReport, type Report, renderMarkdown, scanAgentSetup, staleInstructionMessages } from "../src/index.js";
import type { ReportStaleInstruction } from "../src/report.js";

// Stale instructions (Horizon 2 item H3): the "📄 Instructions" section of the PR comment.

const STALE: ReportStaleInstruction[] = [
  { id: "SI01", path: "CLAUDE.md", line: 4, kind: "command", token: "pnpm run format" },
  { id: "SI02", path: "CLAUDE.md", line: 11, kind: "path", token: "scripts/changelog.sh" },
  { id: "SI03", path: "CLAUDE.md", line: 15, kind: "file" },
  { id: "SI04", path: "AGENTS.md", line: 1, kind: "path", token: "src/index.ts" },
];

function reportWith(stale: ReportStaleInstruction[]): Report {
  return buildReport({
    version: "0.7.0",
    diffCoverage: null,
    threshold: null,
    missing: { reason: "diff-unavailable", detail: "no base" },
    agentSetup: scanAgentSetup(["AGENTS.md", "CLAUDE.md"]),
    staleInstructions: stale,
    staleInstructionMessages: staleInstructionMessages(stale, {}),
  });
}

describe("the Instructions section", () => {
  it("lists each finding with its id, location and fixed words, warnings first, then one hint per id; the messages section leaves the stale messages out", () => {
    const markdown = renderMarkdown(reportWith(STALE));
    const section = markdown.slice(markdown.indexOf("### 📄 Instructions"), markdown.indexOf("### 💬 Messages"));
    expect(section.split("\n")).toEqual([
      "### 📄 Instructions",
      "",
      "- ⚠️ **SI01** `CLAUDE.md:4` — command `pnpm run format` is not defined in the root package.json or Makefile",
      "- ⚠️ **SI02** `CLAUDE.md:11` — path `scripts/changelog.sh` is not in the repository",
      "- ⚠️ **SI03** `CLAUDE.md:15` — file to read is not in the repository",
      "- ℹ️ **SI04** `AGENTS.md:1` — last changed more than 90 days ago, and names `src/index.ts`, which this change edits",
      "- SI01 hint: Make the command match a script in the root package.json or a target in the root Makefile, or remove it from the instruction file.",
      "- SI02 hint: Point the instruction at the path where the file now lives, or remove the line.",
      "- SI03 hint: Point the link or `@` import at a file that exists, or remove it.",
      "- SI04 hint: Read the instruction file next to the files this change edits, and update it where it no longer matches.",
      "",
      "",
    ]);
    const messages = markdown.slice(markdown.indexOf("### 💬 Messages"));
    expect(messages).not.toContain("SETUP_STALE");
    expect(messages).not.toContain("Agent instruction files");
  });

  it("a report without findings has no section and renders as before", () => {
    const markdown = renderMarkdown(reportWith([]));
    expect(markdown).not.toContain("📄 Instructions");
    const { setupHealth: _ignored, ...rest } = reportWith(STALE);
    expect(renderMarkdown({ ...rest, messages: [] } as Report)).not.toContain("📄 Instructions");
  });

  it("folds findings past the first 10 and counts those past 20; a hand-built report's malformed entries and markdown in a token are neutralized", () => {
    const many: ReportStaleInstruction[] = Array.from({ length: 23 }, (_, i) => ({
      id: "SI02",
      path: "CLAUDE.md",
      line: i + 1,
      kind: "path",
      token: `src/f${i}.ts`,
    }));
    const markdown = renderMarkdown(reportWith(many));
    expect(markdown).toContain("<details><summary>10 more findings</summary>");
    expect(markdown).toContain("- _…and 3 more in report.json._");

    const report = reportWith(STALE);
    const hostile = {
      ...report,
      setupHealth: {
        stale: [
          { id: "SI09", path: "x", line: 1, kind: "path" },
          { id: "SI02", path: "y", line: 1, kind: "other" },
          { id: "SI02", path: 3, line: 1, kind: "path" },
          { id: "SI02", path: "a|b", line: 2, kind: "path", token: "x`|<b>" },
        ],
      },
    } as unknown as Report;
    const out = renderMarkdown(hostile);
    expect(out).not.toContain("SI09");
    expect(out).toContain("- ⚠️ **SI02** `a\\|b:2` — path `x'\\|<b>` is not in the repository");
    expect(out.match(/\*\*SI02\*\*/g)).toHaveLength(1);
  });
});
