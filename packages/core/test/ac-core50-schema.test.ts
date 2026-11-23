import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// CORE-50 (binary-diff-not-blind). The schema is read inside the test body: the passages of the five codes this change
// touches name the binary case. (CORE-132: the comparisons of report.v1.json and report.v2.json with an old commit were
// history pins and are removed.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CODES = ["TEST_INTEGRITY_TI01", "TEST_INTEGRITY_TI10", "TEST_INTEGRITY_TI11", "TEST_INTEGRITY_TI14"] as const;
const UNAVAILABLE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";

const atHead = (path: string) => readFileSync(`${ROOT}${path}`);

/** The passage of `code` in the known-codes description: from `CODE (` to its matching closing parenthesis. */
function passage(text: string, code: string): string {
  const start = text.indexOf(`${code} (`);
  expect(start, `the description names ${code}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start + code.length + 1; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`no closing parenthesis for ${code}`);
}

describe("CORE-50: the schema describes the binary case", () => {
  it("AC-19: the TI01, TI10, TI11, TI14 and TEST_INTEGRITY_INDEX_UNAVAILABLE passages of report.v2.json name the binary case and the reason binary", () => {
    const head = JSON.parse(atHead("schema/report.v2.json").toString("utf8"));
    const headCodes = head.$defs.message.properties.code.description as string;
    for (const code of [...CODES, UNAVAILABLE]) {
      expect(passage(headCodes, code), `${code}: the passage names the binary case`).toMatch(/\bbinary\b/);
    }
    expect(passage(headCodes, UNAVAILABLE), `${UNAVAILABLE}: names the reason binary`).toMatch(
      /reason (?:code )?`?binary\b/,
    );
  });
});
