import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// precision-v030: docs/PRECISION.md section 2 gains one `### … Official results …` subsection naming the run (date,
// commit, CSV path, 600 PRs, the reproduce command) with a block table whose every cell is recomputed here from
// fixtures/corpus/review.csv through scripts/corpus-lib.mjs, so the published table cannot drift from the data.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

type Row = Record<string, string>;
type Entry = {
  signal: string;
  blockPrs: number;
  tp: number;
  fp: number;
  unclear: number;
  fpPrs: number;
  decision: string;
};
type Lib = {
  parseCsv: (text: string) => Row[];
  aggregate: (rows: Row[]) => { prs: number; signals: Entry[] };
  formatRate: (fpPrs: number, prs: number) => string;
};

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

describe("docs/PRECISION.md Official results: the block table", () => {
  it("AC-4: section 2 holds exactly one Official results subsection with the date, commit, CSV path, 600, the reproduce command and a block table recomputed from review.csv", async () => {
    const { parseCsv, aggregate, formatRate } = await load();
    const rows = parseCsv(read("fixtures/corpus/review.csv"));
    const summary = aggregate(rows);

    const subs = h3Subsections(h2Section(read("docs/PRECISION.md"), "## 2. Precision corpus"), "Official results");
    expect(subs, "exactly one ### subsection whose heading contains Official results").toHaveLength(1);
    const sub = subs[0] as string[];
    const text = sub.join("\n");
    for (const needle of [
      "2026-10-26",
      "b31de0c",
      "fixtures/corpus/review.csv",
      "600",
      "node scripts/corpus-rate.mjs fixtures/corpus/review.csv",
    ]) {
      expect(text, needle).toContain(needle);
    }

    const expected = summary.signals.map((entry) => [
      entry.signal,
      String(rows.filter((row) => row.signal === entry.signal && row.severity === "block").length),
      String(entry.blockPrs),
      String(entry.tp),
      String(entry.fp),
      String(entry.unclear),
      formatRate(entry.fpPrs, summary.prs),
      entry.decision,
    ]);
    expect(expected.length, "review.csv has block signals").toBeGreaterThan(0);
    expect(tables(sub), "a table whose rows are the block table recomputed from review.csv").toContainEqual(expected);
  });
});
