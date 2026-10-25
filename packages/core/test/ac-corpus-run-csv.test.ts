import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// corpus-run-script: scripts/corpus-lib.mjs serializes review rows as RFC 4180 CSV (CRLF records with a final CRLF,
// the ten-column header first, a field quoted exactly when it holds a comma, a double quote or a line break, inner
// quotes doubled, spaces kept) and parses that text back to the same rows. The rows are sorted before writing, so any
// input order gives the same text. The module is imported inside each test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HEADER = "repo,pr,signal,severity,path,line,code,detail,verdict,note";

type Row = {
  repo: string;
  pr: string;
  signal: string;
  severity: string;
  path: string;
  line: string;
  code: string;
  detail: string;
  verdict: string;
  note: string;
};
type Lib = { serializeCsv: (rows: Row[]) => string; parseCsv: (text: string) => Row[] };

const load = async (): Promise<Lib> =>
  (await import(pathToFileURL(join(ROOT, "scripts/corpus-lib.mjs")).href)) as unknown as Lib;

const row = (pr: string, fields: Partial<Row>): Row => ({
  repo: "local/upstream",
  pr,
  signal: "",
  severity: "",
  path: "",
  line: "",
  code: "",
  detail: "",
  verdict: "",
  note: "",
  ...fields,
});

// Already in the sorted order (one repository, ascending PR numbers), so the parsed rows equal this list as it is.
const ROWS: Row[] = [
  row("1", {
    signal: "TI01",
    severity: "block",
    path: "src/a.test.ts",
    code: "TEST_INTEGRITY_TI01",
    detail: "a,b",
  }),
  row("2", {
    signal: "TI04",
    severity: "block",
    path: "src/b.test.ts",
    line: "12",
    code: "TEST_INTEGRITY_TI04",
    detail: 'say "hi"',
    verdict: "TP",
  }),
  row("3", {
    signal: "TI02",
    severity: "warn",
    path: "src/c.test.ts",
    code: "TEST_INTEGRITY_TI02",
    detail: "two\nlines",
  }),
  row("4", {
    signal: "TI03",
    severity: "block",
    path: "src/d.test.ts",
    line: "7",
    code: "TEST_INTEGRITY_TI03",
    detail: "two\r\nlines",
    verdict: "FP",
    note: 'a,b and "q"',
  }),
  row("5", {
    signal: "TI05",
    severity: "info",
    path: "src/e.test.ts",
    code: "TEST_INTEGRITY_TI05",
    detail: " padded ",
    verdict: "unclear",
    note: " padded ",
  }),
  row("6", { signal: "none" }),
];

const RECORDS = [
  HEADER,
  'local/upstream,1,TI01,block,src/a.test.ts,,TEST_INTEGRITY_TI01,"a,b",,',
  'local/upstream,2,TI04,block,src/b.test.ts,12,TEST_INTEGRITY_TI04,"say ""hi""",TP,',
  'local/upstream,3,TI02,warn,src/c.test.ts,,TEST_INTEGRITY_TI02,"two\nlines",,',
  'local/upstream,4,TI03,block,src/d.test.ts,7,TEST_INTEGRITY_TI03,"two\r\nlines",FP,"a,b and ""q"""',
  "local/upstream,5,TI05,info,src/e.test.ts,,TEST_INTEGRITY_TI05, padded ,unclear, padded ",
  "local/upstream,6,none,,,,,,,",
];
const EXPECTED = RECORDS.map((record) => `${record}\r\n`).join("");

describe("corpus-run-script: the CSV module", () => {
  it("AC-7: serializeCsv writes the header first, quotes exactly the fields with a comma, a quote or a line break, and ends every record with CRLF", async () => {
    const { serializeCsv } = await load();
    const text = serializeCsv(ROWS);
    expect(text.startsWith(`${HEADER}\r\n`), "the first line is the header").toBe(true);
    expect(text.endsWith("\r\n"), "the last record ends with CRLF").toBe(true);
    expect(text).toContain('"a,b"');
    expect(text).toContain('"say ""hi"""');
    expect(text).toContain('"two\nlines"');
    expect(text).toContain('"two\r\nlines"');
    expect(text).toContain(", padded ,");
    expect(text).not.toContain('" padded "');
    expect(text).toBe(EXPECTED);
  });

  it("AC-7: parseCsv reads the serialized text back to rows equal to the input", async () => {
    const { serializeCsv, parseCsv } = await load();
    expect(parseCsv(serializeCsv(ROWS))).toEqual(ROWS);
    expect(parseCsv(EXPECTED)).toEqual(ROWS);
  });

  it("AC-7: the same rows reversed or shuffled serialize to the identical text", async () => {
    const { serializeCsv } = await load();
    const reference = serializeCsv(ROWS);
    const reversed = [...ROWS].reverse();
    const shuffled = [3, 0, 5, 1, 4, 2].map((index) => ROWS[index] as Row);
    expect(serializeCsv(reversed)).toBe(reference);
    expect(serializeCsv(shuffled)).toBe(reference);
  });
});
