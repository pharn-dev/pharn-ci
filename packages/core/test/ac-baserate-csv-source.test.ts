import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// baserate-csv-safe-cells AC-5: main() guards the hits.csv write with an explicit refusal, the shape CodeQL
// recognises as a sanitizer barrier for js/http-to-file-access: an `if` testing an inverted-class regex literal on
// the text that is written, followed by `throw`, before the writeFileSync( call that writes hits.csv.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/agent-pr-baserate.mjs");

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** The body of `function main(...) { ... }` (sync or async), by brace matching from its opening brace; "" when absent. */
const mainBody = (source: string): string => {
  const start = source.search(/(?:async\s+)?function\s+main\s*\(/);
  if (start < 0) return "";
  const paramsEnd = source.indexOf(")", start);
  const open = source.indexOf("{", paramsEnd);
  if (paramsEnd < 0 || open < 0) return "";
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return "";
};

/** Index just past the string or template literal starting at `start` (whose char is a quote or backtick). */
const skipString = (src: string, start: number): number => {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return i;
};

/** The argument text of the call whose `(` is at `open`, exclusive; strings are skipped. */
const callArgs = (src: string, open: number): string | undefined => {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(src, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
    i++;
  }
  return undefined;
};

/** Top-level comma-separated arguments of a call's argument text. */
const splitArgs = (text: string): string[] => {
  const args: string[] = [];
  let depth = 0;
  let from = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(text, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      args.push(text.slice(from, i).trim());
      from = i + 1;
    }
    i++;
  }
  const last = text.slice(from).trim();
  if (last !== "") args.push(last);
  return args;
};

describe("agent-pr-baserate main() hits.csv write source", () => {
  it("AC-5: the writeFileSync( call writing hits.csv comes after an if (/[^...]/.test(<id>)) throw guard on the same <id> it writes", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const body = mainBody(source);
    expect(body, "function main has a body").not.toBe("");

    // The writeFileSync( call whose path argument names hits.csv.
    const writes = [...body.matchAll(/\bwriteFileSync\s*\(/g)]
      .map((m) => {
        const open = m.index + m[0].length - 1;
        return { index: m.index, args: splitArgs(callArgs(body, open) ?? "") };
      })
      .filter((w) => (w.args[0] ?? "").includes("hits.csv"));
    expect(writes, "one writeFileSync( call in main() writes hits.csv").toHaveLength(1);
    const write = writes[0] as { index: number; args: string[] };

    // It writes a named value, not an inline expression, so the guard can test that same value.
    const id = write.args[1] ?? "";
    expect(id, "hits.csv is written from an identifier").toMatch(/^[A-Za-z_$][\w$]*$/);

    // `if (/[^...]/flags.test(<id>))` followed by `throw`, with or without a block, before the write.
    const guard = new RegExp(
      `if\\s*\\(\\s*\\/\\[\\^(?:\\\\.|[^\\]\\\\\\n])*\\]\\/[a-z]*\\.test\\(\\s*${escapeRe(id)}\\s*\\)\\s*\\)\\s*(?:\\{\\s*)?throw\\b`,
    ).exec(body.slice(0, write.index));
    expect(guard, `an if (/[^...]/.test(${id})) throw guard before the hits.csv write`).not.toBeNull();

    // Nothing reassigns the written value between the guard and the write.
    const between = body.slice(guard?.index ?? 0, write.index);
    expect(new RegExp(`(?<![\\w$.])${escapeRe(id)}\\s*(?:[-+*/]?=)(?!=)`).test(between)).toBe(false);
  });
});
