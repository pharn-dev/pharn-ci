import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SECURITY.md and the Marketplace listing must not promise that agent setup files are never read: check A7 reads the
// machine-readable kinds at HEAD, and policy mode reads the settings, MCP and instruction files (review A7-F1).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** The `|`-delimited rows of the `## Data handling` table in SECURITY.md, split into trimmed cells. */
function dataHandlingRows(): string[][] {
  const text = read("SECURITY.md");
  const start = text.indexOf("## Data handling");
  expect(start, "SECURITY.md has a ## Data handling section").toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + 1);
  const next = rest.search(/^## /m);
  const body = next === -1 ? rest : rest.slice(0, next);
  return body
    .split("\n")
    .filter((line) => line.startsWith("| "))
    .map((line) =>
      line
        .slice(1, line.endsWith("|") ? -1 : undefined)
        .split("|")
        .map((cell) => cell.trim()),
    );
}

function rowWhoseDataCell(includes: string): string[] {
  const rows = dataHandlingRows().filter((cells) => cells[0]?.includes(includes));
  expect(rows, `exactly one Data handling row whose Data cell names "${includes}"`).toHaveLength(1);
  const row = rows[0] as string[];
  expect(row, "the row has three cells").toHaveLength(3);
  return row;
}

describe("the never-read promise is gone from SECURITY.md and the Marketplace listing", () => {
  it("AC-1: SECURITY.md has no 'never read' in any letter case", () => {
    expect(read("SECURITY.md")).not.toMatch(/never read/i);
  });

  it("AC-2: the agent setup paths-and-kinds row says the inventory matches by path, A7 reads the machine-readable kinds at HEAD for secrets, and policy mode reads settings, MCP and instruction files", () => {
    const where = rowWhoseDataCell("agent setup file paths and kinds")[1] as string;
    for (const phrase of [
      "inventory",
      "by path",
      "A7",
      "machine-readable",
      "`HEAD`",
      "secrets",
      "policy mode",
      "settings",
      "MCP",
      "instruction",
    ]) {
      expect(where, `the row's "Where it goes" cell names ${phrase}`).toContain(phrase);
    }
  });

  it("AC-3: a row for the text of the agent config, settings and instruction files says it never reaches the comment, summary, log, report.json or upload, and names THREAT-MODEL C4, C5 and C6", () => {
    const [, where, retention] = rowWhoseDataCell("Text of the agent config, settings and instruction files") as [
      string,
      string,
      string,
    ];
    expect(where).toContain("never reaches");
    for (const place of ["PR comment", "job summary", "step log", "`report.json`", "upload"]) {
      expect(where, `the row names ${place}`).toContain(place);
    }
    expect(where).toContain("docs/THREAT-MODEL.md");
    expect(where).toContain("C4, C5 and C6");
    expect(retention).toBe("Not stored.");
  });

  it("AC-4: docs/MARKETPLACE.md has no 'never read' in any letter case, and its Description still lists the files by kind", () => {
    const text = read("docs/MARKETPLACE.md");
    expect(text).not.toMatch(/never read/i);
    const start = text.indexOf("## Description");
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = text.slice(start + 1);
    const description = rest.slice(0, rest.search(/^## /m));
    expect(description).toContain("It lists these files by kind.");
  });
});
