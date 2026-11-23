import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeTable, messageCodes } from "./codeTable.js";
import { validateReport } from "./schema.js";

// Report v2 compatibility (CORE-132, AGENTS.md rule 2): within v2 nothing is removed, renamed or retyped.
// 1. Every report committed under fixtures/ (report*.json) validates against the current schema/report.v2.json, so a
//    removed or retyped property, or a narrowed enum, fails here.
// 2. Every message code a release shipped, listed append-only in fixtures/release/codes.txt (docs/RELEASING.md), is
//    still a MessageCode, still valid in a message the schema checks, and still has a row in the code table of
//    docs/output.md that the schema's message-code description links to (CORE-140).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("Report v2 compatibility", () => {
  it("every committed report fixture is a v2 report that validates against schema/report.v2.json", () => {
    const files = readdirSync(join(ROOT, "fixtures"), { recursive: true, encoding: "utf8" })
      .map((name) => `fixtures/${name.split("\\").join("/")}`)
      .filter((path) => /(?:^|\/)report[^/]*\.json$/.test(path))
      .sort();
    expect(files.length, "the committed report fixtures").toBeGreaterThanOrEqual(12);
    for (const path of files) {
      const report = JSON.parse(read(path)) as { schemaVersion?: unknown };
      expect(report.schemaVersion, `${path}: schemaVersion`).toBe(2);
      expect(validateReport(report), `${path}: ${JSON.stringify(validateReport.errors)}`).toBe(true);
    }
  });

  it("every released message code is still a MessageCode, valid in a schema-checked message, and documented", () => {
    const released = read("fixtures/release/codes.txt")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
    expect(released.length, "the codes of v0.10.0 and later").toBeGreaterThanOrEqual(89);
    expect(new Set(released).size, "no code is listed twice").toBe(released.length);
    for (const code of released) expect(code, "a code word").toMatch(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/);

    // CORE-140: the MessageCode union is partly derived (the TEST_INTEGRITY_<id> codes come from the signal registry),
    // so the codes are read from MESSAGE_FIXES, a Record over that union, not from the text of report.ts. The schema
    // names no code since its code description became one sentence and a link (it has a pattern and no enum), so each
    // code is checked in a message the schema validates and against the code table the schema links to.
    const inCode = new Set(messageCodes());
    const documented = codeTable();
    expect(
      released.filter((code) => !inCode.has(code)),
      "released codes missing from MessageCode",
    ).toEqual([]);
    expect(
      released.filter((code) => !documented.has(code)),
      "released codes missing from the code table",
    ).toEqual([]);
    const report = JSON.parse(read("fixtures/golden/report.json")) as { messages: unknown[] };
    for (const code of released) {
      const withCode = { ...report, messages: [{ level: "info", code, text: "released code" }] };
      expect(validateReport(withCode), `${code}: ${JSON.stringify(validateReport.errors)}`).toBe(true);
    }
    // Control: a code word the pattern refuses fails the same check.
    expect(validateReport({ ...report, messages: [{ level: "info", code: "lower_case", text: "x" }] })).toBe(false);
  });
});
