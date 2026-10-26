import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// precision-v030: the reviewed CSV of the official v0.3.0 precision run is committed as fixtures/corpus/review.csv, a
// byte copy of the file the delegate reviewed. Its sha256 pins the bytes; parseCsv/serializeCsv from
// scripts/corpus-lib.mjs show it is in the canonical form corpus-run writes. The module and the file are read inside
// the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SHA256 = "d5719d5a1d77180496e17cbd283c617781f64257121222c4296778c837673893";

type Row = Record<
  "repo" | "pr" | "signal" | "severity" | "path" | "line" | "code" | "detail" | "verdict" | "note",
  string
>;
type Lib = {
  parseCsv: (text: string) => Row[];
  serializeCsv: (rows: Row[]) => string;
  verdictError: (rows: Row[]) => string | null;
};

const load = async (): Promise<Lib> =>
  (await import(pathToFileURL(join(ROOT, "scripts/corpus-lib.mjs")).href)) as unknown as Lib;

describe("fixtures/corpus/review.csv", () => {
  it("AC-1: is the reviewed CSV byte for byte (sha256), in canonical form, with 735 rows and only known verdicts", async () => {
    const { parseCsv, serializeCsv, verdictError } = await load();
    const bytes = readFileSync(join(ROOT, "fixtures/corpus/review.csv"));
    expect(createHash("sha256").update(bytes).digest("hex"), "sha256 of the committed CSV").toBe(SHA256);

    const text = bytes.toString("utf8");
    const rows = parseCsv(text);
    expect(serializeCsv(rows) === text, "serializeCsv(parseCsv(text)) equals the file's text exactly").toBe(true);
    expect(rows).toHaveLength(735);
    expect(verdictError(rows)).toBeNull();
    const verdicts = new Set(rows.map((row) => row.verdict));
    for (const verdict of verdicts) expect(["", "TP", "FP", "unclear"]).toContain(verdict);
  });
});
