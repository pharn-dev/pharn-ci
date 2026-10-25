import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url);

/** The numbered entries of THREAT-MODEL.md section 3 (Named residual risks), each with its continuation lines. */
function residualEntries(doc: string): string[] {
  const start = doc.indexOf("\n## 3.");
  const end = doc.indexOf("\n## 4.", start);
  expect(start, "THREAT-MODEL.md has section 3").toBeGreaterThan(-1);
  expect(end, "THREAT-MODEL.md has section 4").toBeGreaterThan(start);
  return doc
    .slice(start, end)
    .split(/\n(?=\d+\.\s)/)
    .filter((entry) => /^\d+\.\s/.test(entry));
}

describe("THREAT-MODEL.md: the TypeScript parser", () => {
  it("AC-15: names the parse-only TypeScript parser, its caps and its refusals, and row A1 names it as not hand-written", () => {
    const doc = readFileSync(new URL("docs/THREAT-MODEL.md", ROOT), "utf8");

    const entries = residualEntries(doc).filter((e) => e.includes("createSourceFile"));
    expect(entries.length, "a residual entry for the TypeScript parser").toBeGreaterThan(0);
    const entry = entries.find((e) => e.includes("parser-threw")) ?? (entries[0] as string);
    expect(entry).toMatch(/TypeScript/);
    expect(entry).toMatch(/test.file/i);
    expect(entry).toMatch(/parse.only|only.{0,40}parse/i);
    expect(entry).toMatch(/evaluat/i);
    expect(entry).toMatch(/512\s*KiB/);
    expect(entry).toContain("too-deep");
    expect(entry).toContain("parser-threw");
    expect(entry).toMatch(/escap/i);

    const a1 = doc.split("\n").find((line) => /^\|\s*A1\s*\|/.test(line));
    expect(a1, "the surface row A1").toBeDefined();
    expect(a1).toMatch(/TypeScript/);
    expect(a1).toMatch(/not hand-written/i);
  });
});
