import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// The renderer and the fixtures are loaded inside the test body: the AC tests are written before agentSetup.missing
// and fixtures/setup-expect/ exist, so nothing that depends on them may run while the file loads.

const MISSING_LINE = "Missing: `claude-code`, `cursor`";
const GENERIC_MISSING = "Missing: an agent instructions file, typically";

/** The lines of the "### Agent setup" section, up to the next heading. */
function agentSetupSection(markdown: string): string[] {
  const all = markdown.split("\n");
  const start = all.indexOf("### Agent setup");
  expect(start, "the markdown has an ### Agent setup section").toBeGreaterThanOrEqual(0);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("#"));
  return end === -1 ? rest : rest.slice(0, end);
}

type Report = { agentSetup: { files: unknown[]; missing?: unknown } };

describe("renderMarkdown: agentSetup.missing", () => {
  it("AC-7: renders the Missing line after the setup summary, or in place of the generic line with zero files; goldens are unchanged", async () => {
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const render = (report: unknown) => renderMarkdown(report as Parameters<typeof renderMarkdown>[0]);

    // Reports with no agentSetup.missing, or an empty one, render byte-identical to the committed golden markdown.
    for (const dir of ["golden", "golden-cobertura", "golden-exclusions", "golden-multi"]) {
      const report = JSON.parse(fixture(`${dir}/report.json`)) as Report;
      expect(Object.hasOwn(report.agentSetup, "missing"), dir).toBe(false);
      expect(render(report), `${dir}/report.md`).toBe(fixture(`${dir}/report.md`));
      const withEmpty = { ...report, agentSetup: { ...report.agentSetup, missing: [] } };
      expect(render(withEmpty), `${dir}/report.md with missing: []`).toBe(fixture(`${dir}/report.md`));
    }

    // Setup files exist: the Missing line comes after the "Agent setup: N file(s) · ..." line, before the table.
    const withFiles = JSON.parse(fixture("setup-expect/report-files-missing.json")) as Report;
    expectValidReport(withFiles);
    expect(withFiles.agentSetup.files.length).toBeGreaterThan(0);
    expect(withFiles.agentSetup.missing).toEqual(["claude-code", "cursor"]);
    const filesSection = agentSetupSection(render(withFiles));
    const summaryAt = filesSection.findIndex((line) => line.startsWith("Agent setup: "));
    const missingAt = filesSection.indexOf(MISSING_LINE);
    const tableAt = filesSection.indexOf("| Path | Kind |");
    expect(summaryAt).toBeGreaterThanOrEqual(0);
    expect(missingAt).toBeGreaterThan(summaryAt);
    if (tableAt !== -1) expect(missingAt).toBeLessThan(tableAt);
    expect(filesSection.filter((line) => line.startsWith("Missing:"))).toEqual([MISSING_LINE]);

    // Zero setup files: "_No agent setup files found._" stays, and the Missing line replaces the generic one.
    const noFiles = JSON.parse(fixture("setup-expect/report-no-files-missing.json")) as Report;
    expectValidReport(noFiles);
    expect(noFiles.agentSetup.files).toEqual([]);
    expect(noFiles.agentSetup.missing).toEqual(["claude-code", "cursor"]);
    const noFilesSection = agentSetupSection(render(noFiles));
    const noneAt = noFilesSection.indexOf("_No agent setup files found._");
    expect(noneAt).toBeGreaterThanOrEqual(0);
    expect(noFilesSection.indexOf(MISSING_LINE)).toBeGreaterThan(noneAt);
    expect(noFilesSection.some((line) => line.startsWith(GENERIC_MISSING))).toBe(false);
    expect(noFilesSection.filter((line) => line.startsWith("Missing:"))).toEqual([MISSING_LINE]);
  });
});
