import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The documents are read inside each test body: the build edits them, after this test is written.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** The lines after the first line starting `start` and before the next line matching `end` (to the end if none). */
function between(lines: string[], start: (line: string) => boolean, end: (line: string) => boolean): string[] {
  const from = lines.findIndex(start);
  if (from === -1) return [];
  const rest = lines.slice(from + 1);
  const to = rest.findIndex(end);
  return to === -1 ? rest : rest.slice(0, to);
}

/** The surface-table row of THREAT-MODEL.md whose first cell is `id`. */
const surfaceRow = (doc: string, id: string) =>
  doc.split("\n").find((line) => new RegExp(`^\\|\\s*${id}\\s*\\|`).test(line));

/** The numbered entries of THREAT-MODEL.md section 3 (Named residual risks), each with its continuation lines. */
function residualEntries(doc: string): string[] {
  const start = doc.indexOf("\n## 3.");
  const end = doc.indexOf("\n## 4.", start);
  expect(start, "THREAT-MODEL.md has section 3").toBeGreaterThan(-1);
  expect(end, "THREAT-MODEL.md has section 4").toBeGreaterThan(start);
  return doc
    .slice(start, end)
    .split(/\n(?=\d+\.\s)/)
    .filter((entry) => /^\d+\.\s/.test(entry));
}

describe("agent-pr-detection: documentation", () => {
  it("AC-15: THREAT-MODEL row D1 names the read-only pull request commits call", () => {
    const d1 = surfaceRow(read("docs/THREAT-MODEL.md"), "D1");
    expect(d1, "the surface row D1").toBeDefined();
    expect(d1).toContain("GET /repos/{owner}/{repo}/pulls/{n}/commits");
  });

  it("AC-15: THREAT-MODEL has a surface row A5 naming commit messages", () => {
    const a5 = surfaceRow(read("docs/THREAT-MODEL.md"), "A5");
    expect(a5, "the surface row A5").toBeDefined();
    expect(a5).toMatch(/commit messages?/i);
  });

  it("AC-15: THREAT-MODEL residual entries 22 and 23 cover detection that sees only what identifies itself and the commit messages the Action reads", () => {
    const entries = residualEntries(read("docs/THREAT-MODEL.md"));
    const entry22 = entries.find((entry) => entry.startsWith("22. "));
    const entry23 = entries.find((entry) => entry.startsWith("23. "));
    expect(entry22, "residual entry 22").toBeDefined();
    expect(entry22).toMatch(/agent/i);
    expect(entry22, "an agent PR that does not identify itself counts as human").toMatch(/human|person/i);
    expect(entry23, "residual entry 23").toBeDefined();
    expect(entry23).toMatch(/commit messages?/i);
    expect(entry23).toMatch(/trailer/i);
  });

  it("AC-15: LIMITS has ## 9. Agent-PR detection naming 250, Dependabot, labels as the event delivered them, the verified list and .pharn/ci.yml", () => {
    const limits = read("docs/LIMITS.md").split("\n");
    expect(
      limits.some((line) => line.startsWith("## 9. Agent-PR detection")),
      "the ## 9. heading",
    ).toBe(true);
    const section = between(
      limits,
      (l) => l.startsWith("## 9. Agent-PR detection"),
      (l) => l.startsWith("## "),
    ).join("\n");
    expect(section).toMatch(/\b250\b/);
    expect(section).toMatch(/Dependabot/);
    expect(section, "labels read as the event delivered them").toMatch(/label[\s\S]*event|event[\s\S]*label/i);
    expect(section).toMatch(/verified/i);
    expect(section).toContain(".pharn/ci.yml");
  });

  it("AC-15: README has ### Agent PRs inside ## Report v2 naming meta.isAgentPr, ai-generated and 250", () => {
    const readme = read("README.md").split("\n");
    const reportV2 = between(
      readme,
      (l) => l.startsWith("## Report v2"),
      (l) => l.startsWith("## "),
    );
    expect(reportV2.length, "README has ## Report v2").toBeGreaterThan(0);
    expect(
      reportV2.some((l) => l.startsWith("### Agent PRs")),
      "### Agent PRs inside ## Report v2",
    ).toBe(true);
    const agentPrs = between(
      reportV2,
      (l) => l.startsWith("### Agent PRs"),
      (l) => l.startsWith("### ") || l.startsWith("## "),
    ).join("\n");
    expect(agentPrs).toContain("meta.isAgentPr");
    expect(agentPrs).toContain("ai-generated");
    expect(agentPrs).toMatch(/\b250\b/);
  });

  it("AC-15: CHANGELOG [Unreleased] names meta.isAgentPr under Added and pulls/{n}/commits under Security", () => {
    const unreleased = between(
      read("CHANGELOG.md").split("\n"),
      (l) => l.startsWith("## [Unreleased]"),
      (l) => l.startsWith("## ["),
    );
    const added = between(
      unreleased,
      (l) => l.startsWith("### Added"),
      (l) => l.startsWith("### "),
    );
    const security = between(
      unreleased,
      (l) => l.startsWith("### Security"),
      (l) => l.startsWith("### "),
    );
    expect(
      added.some((l) => l.includes("meta.isAgentPr")),
      "Added names meta.isAgentPr",
    ).toBe(true);
    expect(
      security.some((l) => l.includes("pulls/{n}/commits")),
      "Security names pulls/{n}/commits",
    ).toBe(true);
  });
});
