import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Reads docs/LIMITS.md as text; nothing the build adds is loaded. The `## Python parity` section runs to the next
// `## ` heading: its table, then the Python misses after it.

const limits = () => readFileSync(new URL("../../../docs/LIMITS.md", import.meta.url), "utf8");
const SIGNALS = Array.from({ length: 16 }, (_, i) => `TI${String(i + 1).padStart(2, "0")}`);
const CAUGHT_IN_PYTHON = ["TI01", "TI02", "TI03", "TI05", "TI06", "TI09", "TI13"];
const VERDICT = /^(caught|not applicable|missed)\b\s*(?:—|-|:)\s*\S/;

/** The text of the `## Python parity` section, without its heading, up to the next `## ` heading. */
function section(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^## Python parity\s*$/.test(l));
  if (start < 0) throw new Error("docs/LIMITS.md has no `## Python parity` section");
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** The cells of a markdown table row, trimmed, without the outer pipes. */
const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

describe("docs/LIMITS.md says, per signal and language, what pytest parity catches and misses", () => {
  it("AC-18: a parity table with one row per signal TI01..TI16 in order and the columns JS/TS and Python, each cell caught, not applicable or missed with a reason; TI04 Python not applicable for want of .only; the seven parity signals caught in Python; and a list of the Python misses", () => {
    const text = section(limits());
    const lines = text.split("\n");
    const header = lines.findIndex((l) => /^\|\s*Signal\s*\|\s*JS\/TS\s*\|\s*Python\s*\|\s*$/.test(l));
    expect(header, "the table header | Signal | JS/TS | Python |").toBeGreaterThanOrEqual(0);
    expect(lines[header + 1] ?? "", "the separator row").toMatch(/^\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|\s*$/);
    const rows: string[] = [];
    for (let i = header + 2; i < lines.length && (lines[i] as string).trim().startsWith("|"); i++)
      rows.push(lines[i] as string);
    const table = rows.map(cells);
    expect(
      table.map((r) => (/TI\d\d/.exec(r[0] ?? "") ?? [""])[0]),
      "one row per signal, TI01..TI16 in order",
    ).toEqual(SIGNALS);
    for (const r of table) {
      expect(r, `${r[0]}: three cells`).toHaveLength(3);
      for (const [column, cell] of [
        ["JS/TS", r[1] ?? ""],
        ["Python", r[2] ?? ""],
      ] as const) {
        expect(
          cell.replace(/^\*\*|\*\*/g, ""),
          `${r[0]} ${column}: caught, not applicable or missed, with a reason`,
        ).toMatch(VERDICT);
      }
    }
    const python = (id: string) => (table.find((r) => (r[0] ?? "").includes(id))?.[2] ?? "").replace(/\*\*/g, "");
    expect(python("TI04"), "TI04 Python: not applicable").toMatch(/^not applicable\b/);
    expect(python("TI04"), "TI04 Python: pytest has no .only").toMatch(/pytest has no `?\.only`?/);
    for (const id of CAUGHT_IN_PYTHON) expect(python(id), `${id} Python: caught`).toMatch(/^caught\b/);

    // The Python misses, after the table.
    const after = lines.slice(header + 2 + rows.length).join("\n");
    expect(after, "a list of Python misses").toMatch(/^\s*[-*] /m);
    for (const [what, pattern] of [
      ["monkeypatch.setattr object forms", /monkeypatch\.setattr/],
      ["aliased mock callees (TI12)", /alias[\s\S]{0,200}mock|mock[\s\S]{0,200}alias/i],
      ["TI12", /TI12/],
      ["conftest.py", /conftest\.py/],
      ["PYTEST_ADDOPTS", /PYTEST_ADDOPTS/],
      ["request.node.add_marker", /request\.node\.add_marker/],
      ["aliases bound anywhere but a top-level import", /top-level/i],
      ["import *", /import \*/],
      ["reassignment after import", /reassign|re-assign|assignment/i],
      ["[tool.pytest]", /\[tool\.pytest\]/],
      ["[tool.pytest.ini_options]", /\[tool\.pytest\.ini_options\]/],
      ["the native value winning", /native[\s\S]{0,200}wins|wins[\s\S]{0,200}native/i],
    ] as const) {
      expect(after, `the Python misses name ${what}`).toMatch(pattern);
    }
  });
});
