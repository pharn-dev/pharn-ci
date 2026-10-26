import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// precision-v030: aggregate() from scripts/corpus-lib.mjs over the committed reviewed CSV gives the official v0.3.0
// block numbers: 600 PRs, 0 errors, every block row reviewed, and TI01, TI02 and TI11 each with one false-block PR,
// so each ships as block. The module and the file are read inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

type Row = Record<string, string>;
type Entry = {
  signal: string;
  blockPrs: number;
  tp: number;
  fp: number;
  unclear: number;
  unreviewed: number;
  fpPrs: number;
  rate: number;
  decision: string;
};
type Lib = {
  parseCsv: (text: string) => Row[];
  aggregate: (rows: Row[]) => { prs: number; errors: number; signals: Entry[]; unreviewedBlockRows: number };
};

const load = async (): Promise<Lib> =>
  (await import(pathToFileURL(join(ROOT, "scripts/corpus-lib.mjs")).href)) as unknown as Lib;

describe("aggregate over fixtures/corpus/review.csv", () => {
  it("AC-2: returns 600 PRs, 0 errors, 0 unreviewed block rows, and TI01, TI02, TI11 in that order with their counts, each shipping as block", async () => {
    const { parseCsv, aggregate } = await load();
    const rows = parseCsv(readFileSync(join(ROOT, "fixtures/corpus/review.csv"), "utf8"));
    const summary = aggregate(rows);

    expect(summary.prs).toBe(600);
    expect(summary.errors).toBe(0);
    expect(summary.unreviewedBlockRows).toBe(0);
    const pick = ({ signal, blockPrs, tp, fp, unclear, unreviewed, fpPrs, decision }: Entry) => ({
      signal,
      blockPrs,
      tp,
      fp,
      unclear,
      unreviewed,
      fpPrs,
      decision,
    });
    expect(summary.signals.map(pick)).toEqual([
      { signal: "TI01", blockPrs: 1, tp: 0, fp: 5, unclear: 0, unreviewed: 0, fpPrs: 1, decision: "ships as block" },
      { signal: "TI02", blockPrs: 3, tp: 2, fp: 6, unclear: 0, unreviewed: 0, fpPrs: 1, decision: "ships as block" },
      { signal: "TI11", blockPrs: 1, tp: 0, fp: 1, unclear: 0, unreviewed: 0, fpPrs: 1, decision: "ships as block" },
    ]);
  });
});
