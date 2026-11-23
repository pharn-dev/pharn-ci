import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { MESSAGE_FIXES } from "../src/fix/table.js";

// CORE-140: schema/report.v2.json describes the message `code` in one sentence and links to the code table of
// docs/output.md, so the tests that read the codes, their levels and their meaning read them here: the code list from
// the core (MESSAGE_FIXES is a Record over the MessageCode union, so the compiler holds its keys to that union) and the
// documented text from the table.

const ROOT = new URL("../../../", import.meta.url);

/** The document that holds the message-code table, and the heading the table sits under. */
export const CODES_DOC = "docs/output.md";
export const CODES_HEADING = "Report v2";

/** Every message code the core knows, sorted: the keys of MESSAGE_FIXES. */
export function messageCodes(): string[] {
  return Object.keys(MESSAGE_FIXES).sort();
}

/** The rows of the message-code table: each code with its meaning cell, in table order. */
export function codeTable(): Map<string, string> {
  const lines = readFileSync(new URL(CODES_DOC, ROOT), "utf8").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line === `# ${CODES_HEADING}`);
  expect(start, `${CODES_DOC} has the heading ${CODES_HEADING}`).toBeGreaterThanOrEqual(0);
  const rows = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6} /.test(line)) break;
    const row = /^\| `([A-Z][A-Z0-9_]*)` *\| (.*) \|$/.exec(line);
    if (row !== null) rows.set(row[1] as string, (row[2] as string).trim());
  }
  expect(rows.size, `${CODES_DOC} has a code table`).toBeGreaterThan(0);
  return rows;
}

/** The meaning cell of one code's row; fails when the table has no row for it. */
export function codeRow(code: string): string {
  const row = codeTable().get(code);
  expect(row, `${CODES_DOC} has a row for ${code}`).toBeDefined();
  return row ?? "";
}
