import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// release-030: the README's `## Test integrity` section is current for 0.3.0. It holds one signal table, TI01 to TI16
// in order and nothing else (TI17 is a proposal), whose levels are the ones the signals give and whose JS/TS and Python
// columns follow the Python parity table of docs/LIMITS.md; a note on the python3 the Python test index needs; a
// precision line linking docs/PRECISION.md with the block signals' false-block rate on the 600-PR corpus; and the
// Skylos 7 of 9 (vitest) and 8 of 9 (pytest) sentences. Files are read inside the test body.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

const HEADER = "| Signal | What it reports | Severity in mode `block` | JS/TS | Python |";
const IDS = Array.from({ length: 16 }, (_, i) => `TI${String(i + 1).padStart(2, "0")}`);
/** The signals that never block: their level in both modes. */
const NEVER_BLOCK: Record<string, string> = {
  TI06: "warn",
  TI07: "warn",
  TI08: "warn",
  TI12: "warn",
  TI15: "info",
  TI16: "info",
};

/** A `## ` section's lines after its exact heading line, up to the next `## ` heading. */
function h2Section(all: string[], heading: string): string[] {
  const start = all.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

const cells = (row: string) =>
  row
    .slice(1, row.endsWith("|") ? -1 : undefined)
    .split("|")
    .map((cell) => cell.trim());

/** The word a LIMITS parity cell starts with, as the README column spells it. */
function parity(cell: string): string {
  if (cell.startsWith("caught")) return "yes";
  if (cell.startsWith("missed")) return "no";
  if (cell.startsWith("not applicable")) return "not applicable";
  throw new Error(`unknown parity cell: ${cell}`);
}

describe("release-030: README.md Test integrity section", () => {
  it("AC-5: one signal table lists TI01 to TI16 with their levels and LIMITS' JS/TS and Python parity, the section names python3 and 3.8, links docs/PRECISION.md with the 600-PR false-block rate of TI01, TI02 and TI11, and keeps 7 of 9 and 8 of 9", () => {
    const section = h2Section(lines(read("README.md")), "## Test integrity");

    expect(
      section.filter((line) => line === HEADER),
      "one signal table",
    ).toHaveLength(1);
    expect(
      section.filter((line) => /^\|\s*Signal\s*\|/.test(line)),
      "no second signal table",
    ).toHaveLength(1);
    const start = section.indexOf(HEADER);
    expect(section[start + 1], "the table's delimiter row").toMatch(/^\|(?:\s*:?-{3,}:?\s*\|){5}$/);
    const rest = section.slice(start + 2);
    const end = rest.findIndex((line) => !line.startsWith("|"));
    const rows = (end === -1 ? rest : rest.slice(0, end)).map(cells);
    expect(
      rows.map((row) => row[0]),
      "TI01 to TI16, in order",
    ).toEqual(IDS);
    expect(normalize(section.join("\n")), "no TI17 row").not.toMatch(/\|\s*TI17\s*\|/);

    const limits = lines(read("docs/LIMITS.md"));
    for (const row of rows) {
      const id = row[0] as string;
      expect(row, `${id} has five cells`).toHaveLength(5);
      expect((row[1] as string).length, `${id} says what it reports`).toBeGreaterThan(10);
      const severity = (row[2] as string).replace(/`/g, "").trim();
      if (id in NEVER_BLOCK) expect(severity, `${id}'s level`).toBe(NEVER_BLOCK[id]);
      else expect(severity, `${id} blocks in mode block`).toMatch(/^block\b/);

      const limitsRow = limits.find((line) => line.startsWith(`| ${id} `));
      expect(limitsRow, `the LIMITS parity row for ${id}`).toBeDefined();
      const [, js, py] = cells(limitsRow as string);
      expect(row[3], `${id} JS/TS`).toMatch(new RegExp(`^${parity(js as string)}\\b`));
      expect(row[4], `${id} Python`).toMatch(new RegExp(`^${parity(py as string)}\\b`));
    }

    const text = normalize(section.join("\n"));
    const paragraphs = section
      .join("\n")
      .split(/\n\s*\n/)
      .map(normalize);
    expect(
      paragraphs.some(
        (p) => p.includes("python3") && p.includes("3.8") && p.includes("TEST_INTEGRITY_INDEX_UNAVAILABLE"),
      ),
      "a paragraph names python3, 3.8 and TEST_INTEGRITY_INDEX_UNAVAILABLE",
    ).toBe(true);

    expect(
      paragraphs.some(
        (p) =>
          /\]\((?:\.\/)?docs\/PRECISION\.md(?:#[^)]*)?\)/.test(p) &&
          /\b600\b/.test(p) &&
          p.includes("1 of 600") &&
          ["TI01", "TI02", "TI11"].every((id) => p.includes(id)),
      ),
      "a paragraph links docs/PRECISION.md and names 600, 1 of 600, TI01, TI02 and TI11",
    ).toBe(true);

    expect(text).toContain("catch **7 of 9**");
    expect(text).toContain("catch **8 of 9**");
  });
});
