import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** The text of one `## `, `### ` or `#### ` section of a markdown file, up to the next heading of any of those levels. */
function sectionOf(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^#{2,4} /.test(line) && line.includes(heading));
  if (start === -1) throw new Error(`no section "${heading}"`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{2,4} /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** The sentences of a text, white space collapsed. */
const sentences = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z`*(-])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

describe("docs/LIMITS.md: .mts and .cts test files", () => {
  it("AC-6: section 1 names .mts and .cts among the test-file extensions, and What TI13 misses no longer says *.test.mts or *.test.cts count as source", () => {
    const limits = read("docs/LIMITS.md");

    const section1 = sectionOf(limits, "1. What diff coverage measures");
    expect(section1).toMatch(/\.mts\b/);
    expect(section1).toMatch(/\.cts\b/);

    const ti13 = sectionOf(limits, "What TI13 misses");
    const asSource = sentences(ti13).filter((s) => /\.test\.[mc]ts\b/.test(s) && /\bsource\b/i.test(s));
    expect(asSource, "no sentence says *.test.mts / *.test.cts files count as source").toEqual([]);
  });
});
