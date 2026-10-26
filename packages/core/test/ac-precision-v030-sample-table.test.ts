import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// precision-v030: the Official results subsection of docs/PRECISION.md names the sampling rule (random.Random(18), 30
// rows) and holds the warn and info sample table, one row per signal and severity of the non-none, non-block rows of
// fixtures/corpus/review.csv, every cell recounted here from the CSV.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

type Row = Record<string, string>;
type Lib = { parseCsv: (text: string) => Row[] };

const load = async (): Promise<Lib> =>
  (await import(pathToFileURL(join(ROOT, "scripts/corpus-lib.mjs")).href)) as unknown as Lib;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));

/** The lines of the `## ` section whose heading starts with `prefix`, after the heading, up to the next `## `. */
function h2Section(text: string, prefix: string): string[] {
  const all = lines(text);
  const start = all.findIndex((line) => line.startsWith(prefix));
  if (start === -1) throw new Error(`no heading starting "${prefix}"`);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

/** Every `### ` subsection of `section` whose heading contains `needle`, each up to the next `### ` or `## `. */
function h3Subsections(section: string[], needle: string): string[][] {
  const out: string[][] = [];
  section.forEach((line, i) => {
    if (!line.startsWith("### ") || !line.includes(needle)) return;
    const rest = section.slice(i + 1);
    const end = rest.findIndex((l) => l.startsWith("### ") || l.startsWith("## "));
    out.push(end === -1 ? rest : rest.slice(0, end));
  });
  return out;
}

/** The data rows of each markdown table (runs of `|` lines), header and separator dropped, cells trimmed, no backticks. */
function tables(sub: string[]): string[][][] {
  const out: string[][][] = [];
  let current: string[][] | null = null;
  for (const line of sub) {
    if (line.trim().startsWith("|")) {
      const cells = line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim().replaceAll("`", ""));
      if (current === null) {
        current = [];
        out.push(current);
      }
      current.push(cells);
    } else current = null;
  }
  return out.map((rows) => rows.slice(1).filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell))));
}

const sorted = (rows: string[][]) => [...rows].sort((a, b) => a.join("|").localeCompare(b.join("|")));

describe("docs/PRECISION.md Official results: the warn and info sample", () => {
  it("AC-5: names random.Random(18) and 30, and holds a sample table with one row per signal and severity of the non-none, non-block rows, recounted from review.csv, and no other row", async () => {
    const { parseCsv } = await load();
    const rows = parseCsv(read("fixtures/corpus/review.csv")).filter(
      (row) => row.signal !== "none" && row.signal !== "error" && row.severity !== "block",
    );
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const key = `${row.signal}\u0000${row.severity}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    expect([...groups.keys()].map((key) => key.replace("\u0000", " ")).sort()).toEqual([
      "TI01 info",
      "TI03 warn",
      "TI07 warn",
      "TI12 warn",
      "TI15 warn",
      "TI16 info",
    ]);
    const expected = [...groups.entries()].map(([key, group]) => {
      const [signal, severity] = key.split("\u0000") as [string, string];
      const count = (verdict: string) => group.filter((row) => row.verdict === verdict).length;
      const rated = group.filter((row) => row.verdict !== "").length;
      return [
        signal,
        severity,
        String(group.length),
        String(rated),
        String(count("TP")),
        String(count("FP")),
        String(count("unclear")),
        `${Math.round((count("TP") * 100) / rated)} %`,
      ];
    });

    const subs = h3Subsections(h2Section(read("docs/PRECISION.md"), "## 2. Precision corpus"), "Official results");
    expect(subs, "exactly one ### subsection whose heading contains Official results").toHaveLength(1);
    const sub = subs[0] as string[];
    const text = sub.join("\n");
    expect(text).toContain("random.Random(18)");
    expect(text).toMatch(/\b30\b/);
    expect(
      tables(sub).map(sorted),
      "a table whose rows are exactly the sample table recounted from review.csv",
    ).toContainEqual(sorted(expected));
  });
});
