import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// CORE-50 (binary-diff-not-blind). The schemas are read inside the test body. report.v1.json stays byte-identical to
// the base commit 0942691; report.v2.json keeps every property, required list, enum, pattern and type, and differs only
// in description text, where the passages of the five codes this change touches name the binary case.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE_COMMIT = "0942691";
const CODES = ["TEST_INTEGRITY_TI01", "TEST_INTEGRITY_TI10", "TEST_INTEGRITY_TI11", "TEST_INTEGRITY_TI14"] as const;
const UNAVAILABLE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";

const atHead = (path: string) => readFileSync(`${ROOT}${path}`);
const atBase = (path: string) => execFileSync("git", ["show", `${BASE_COMMIT}:${path}`], { cwd: ROOT });

/** A JSON value with every `description` string taken out, at any depth. */
function withoutDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDescriptions);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "description" && typeof child === "string") continue;
      out[key] = withoutDescriptions(child);
    }
    return out;
  }
  return value;
}

/** Every description string of a JSON value, at any depth, keyed by its JSON pointer. */
function descriptions(value: unknown, at = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const pointer = `${at}/${key}`;
      if (key === "description" && typeof child === "string") out.set(pointer, child);
      else for (const [p, d] of descriptions(child, pointer)) out.set(p, d);
    }
  }
  return out;
}

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

describe("CORE-50: the schema change is description text only", () => {
  it("AC-19: report.v1.json is byte-identical to the base commit; report.v2.json differs only in descriptions, and the TI01, TI10, TI11, TI14 and TEST_INTEGRITY_INDEX_UNAVAILABLE passages name the binary case and the reason binary", () => {
    expect(
      Buffer.compare(atHead("schema/report.v1.json"), atBase("schema/report.v1.json")),
      "report.v1.json is byte-identical",
    ).toBe(0);

    const head = JSON.parse(atHead("schema/report.v2.json").toString("utf8"));
    const base = JSON.parse(atBase("schema/report.v2.json").toString("utf8"));
    expect(withoutDescriptions(head), "same properties, required lists, enums, patterns and types").toEqual(
      withoutDescriptions(base),
    );
    expect([...descriptions(head).keys()].sort(), "the same description fields, none added or removed").toEqual(
      [...descriptions(base).keys()].sort(),
    );

    const headCodes = head.$defs.message.properties.code.description as string;
    const baseCodes = base.$defs.message.properties.code.description as string;
    for (const code of [...CODES, UNAVAILABLE]) {
      expect(passage(baseCodes, code), `${code}: the base passage does not name binary`).not.toMatch(/binary/i);
      expect(passage(headCodes, code), `${code}: the passage names the binary case`).toMatch(/\bbinary\b/);
    }
    expect(passage(headCodes, UNAVAILABLE), `${UNAVAILABLE}: names the reason binary`).toMatch(
      /reason (?:code )?`?binary\b/,
    );
  });
});
