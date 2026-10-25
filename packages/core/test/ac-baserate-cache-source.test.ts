import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// baserate-cache-control-chars AC-3: writeCached guards its write with an explicit refusal, the shape CodeQL
// recognises as a sanitizer barrier: an `if` testing an inverted-class regex literal that throws, before the
// writeFileSync( call.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/agent-pr-baserate.mjs");

/** The body of `function writeCached(...) { ... }`, by brace matching from its opening brace; "" when absent. */
const writeCachedBody = (source: string): string => {
  const start = source.search(/function\s+writeCached\s*\(/);
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

/** `if (/[^...]/flags.test(...))` followed by `throw`, with or without a block. */
const GUARD = /if\s*\(\s*\/\[\^(?:\\.|[^\]\\\n])*\]\/[a-z]*\.test\([^)]*\)\s*\)\s*(?:\{\s*)?throw\b/;

describe("agent-pr-baserate writeCached source", () => {
  it("AC-3: writeCached holds an if testing an inverted-class regex literal that throws, before its writeFileSync( call", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const body = writeCachedBody(source);
    expect(body, "function writeCached has a body").not.toBe("");

    const guard = GUARD.exec(body);
    expect(guard, "an if (/[^...]/.test(...)) throw guard in writeCached").not.toBeNull();

    const write = body.indexOf("writeFileSync(");
    expect(write, "writeFileSync( in writeCached").toBeGreaterThanOrEqual(0);
    expect(write).toBeGreaterThan(guard?.index ?? Number.POSITIVE_INFINITY);
  });
});
