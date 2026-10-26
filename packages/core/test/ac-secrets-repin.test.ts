import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Reads the repository and two fixed commits with git; nothing the build adds is loaded. b31de0c is the commit the
// precision-v030 pin compares schema/report.v2.json with; e13765681e… is the one the pyparity2 pin compares the schema
// and report.ts code words with. The agent-config secrets change (E3 item 26) may append exactly one text to the
// message-code description and add exactly the 12 AGENT_CONFIG_SECRET_ codes, and re-pins those two tests (D6).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PRECISION_BASE = "b31de0c";
const PYPARITY_BASE = "e13765681e266dd33c27b5d46bbbf34d359cba4e";
const FINAL_SENTENCE = "No code is removed or renamed before 1.0.";
const APPENDED_START = " Codes added in v0.4.0:";
const TI15_START = "TEST_INTEGRITY_TI15 (";
const REPINNED = [
  "packages/core/test/ac-precision-v030-schema.test.ts",
  "packages/action/test/ac-pyparity2-unchanged.test.ts",
];

const CODES = [
  ...Array.from({ length: 11 }, (_, i) => `AGENT_CONFIG_SECRET_S${String(i + 1).padStart(2, "0")}`),
  "AGENT_CONFIG_SECRET_UNSCANNED",
];

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const atCommit = (commit: string, path: string) =>
  execFileSync("git", ["show", `${commit}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** The upper-case code words of a text (as the pyparity2 pin collects them). */
const words = (text: string) =>
  [...new Set([...text.matchAll(/\b(?:TI\d\d|[A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/g)].map((m) => m[0]))].sort();
/** The quoted upper-case string literals of a text (as the pyparity2 pin collects report.ts codes). */
const quotedCodes = (text: string) =>
  [...new Set([...text.matchAll(/"((?:TI\d\d)|(?:[A-Z][A-Z0-9]*_[A-Z0-9_]+))"/g)].map((m) => m[1] as string))].sort();

/** The index of the closing quote of the JSON string that contains index `from`. */
function stringEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === '"') return i;
  }
  throw new Error("unterminated JSON string");
}

/** The [start, end) of the TI15 part, as the precision-v030 pin cuts it. */
function ti15Part(text: string): [number, number] {
  const start = text.indexOf(TI15_START);
  expect(start, `holds "${TI15_START}"`).toBeGreaterThan(-1);
  const next = text.indexOf("TEST_INTEGRITY_", start + TI15_START.length);
  return [start, next === -1 ? text.length : next];
}

describe("the v0.4.0 codes are the only schema and report.ts additions, and the two pins are re-pinned", () => {
  it("AC-24: one appended text after the final sentence names the 12 codes; with it removed the schema is as at b31de0c; the code words are the base's plus the 12; each re-pinned test names this change", () => {
    const schema = read("schema/report.v2.json");

    // The final sentence appears once, and exactly one appended text follows it to the end of the description.
    const sentence = schema.indexOf(FINAL_SENTENCE);
    expect(sentence, "the final sentence is there").toBeGreaterThan(-1);
    expect(schema.indexOf(FINAL_SENTENCE, sentence + 1), "the final sentence appears once").toBe(-1);
    const appendedAt = sentence + FINAL_SENTENCE.length;
    expect(
      schema.slice(appendedAt, appendedAt + APPENDED_START.length),
      "the appended text starts right after it",
    ).toBe(APPENDED_START);
    const end = stringEnd(schema, appendedAt);
    const appended = schema.slice(appendedAt, end);
    expect(appended.indexOf(APPENDED_START, 1), "exactly one appended text").toBe(-1);
    expect(words(appended), "the appended text names the 12 codes and no other code word").toEqual([...CODES].sort());

    // With the appended text removed and the TI15 part put back, the schema is byte-identical to b31de0c.
    const removed = schema.slice(0, appendedAt) + schema.slice(end);
    const base = atCommit(PRECISION_BASE, "schema/report.v2.json");
    const [ns, ne] = ti15Part(removed);
    const [bs, be] = ti15Part(base);
    expect(removed.slice(0, ns) + base.slice(bs, be) + removed.slice(ne), "as at b31de0c").toBe(base);

    // The code words of the schema and report.ts are the pyparity2 base's plus exactly the 12 codes.
    const withCodes = (list: string[]) => [...new Set([...list, ...CODES])].sort();
    const schemaBase = words(atCommit(PYPARITY_BASE, "schema/report.v2.json"));
    for (const code of CODES) expect(schemaBase, `control: ${code} is new`).not.toContain(code);
    expect(words(schema), "schema code words").toEqual(withCodes(schemaBase));
    const reportTs = read("packages/core/src/report.ts");
    const reportBase = quotedCodes(atCommit(PYPARITY_BASE, "packages/core/src/report.ts"));
    expect(quotedCodes(reportTs), "report.ts quoted codes").toEqual(withCodes(reportBase));
    expect(
      words(reportTs)
        .filter((w) => !words(atCommit(PYPARITY_BASE, "packages/core/src/report.ts")).includes(w))
        .sort(),
      "report.ts code words",
    ).toEqual([...CODES].sort());

    // Each re-pinned test carries a comment naming the agent-config secrets change.
    for (const path of REPINNED) {
      const comments = read(path)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("//") || line.startsWith("*") || line.startsWith("/*"));
      expect(
        comments.some((line) => /agent-config secrets/i.test(line)),
        `${path} has a comment naming the agent-config secrets change`,
      ).toBe(true);
    }
    // It spawns git several times, which a loaded host can stretch past vitest's default 5 s.
  }, 60_000);
});
