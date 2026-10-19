import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The docs are read inside the test body, like the other AC tests written before the build.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** The section under the first heading whose text matches `title`, up to the next heading of the same or a higher level. */
function section(markdown: string, title: RegExp): string | null {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^#{1,6} /.test(line) && title.test(line.replace(/^#{1,6} /, "")));
  if (start < 0) return null;
  const level = (lines[start]?.match(/^#+/)?.[0].length ?? 1) as number;
  let end = start + 1;
  while (end < lines.length) {
    const heading = lines[end]?.match(/^(#{1,6}) /);
    if (heading && (heading[1]?.length ?? 0) <= level) break;
    end++;
  }
  return lines.slice(start, end).join("\n");
}

/** Blocks of a markdown text: paragraphs, list items and table rows, each joined into one line. */
function blocks(markdown: string): string[] {
  return markdown.split(/\n\s*\n|\n(?=\s*[-*] )|\n(?=\|)|\n(?=#)/).map((block) => block.replace(/\s*\n\s*/g, " "));
}

/** Sentences of a markdown text: its blocks, split after a full stop or a semicolon. */
function sentences(markdown: string): string[] {
  return blocks(markdown).flatMap((block) => block.split(/(?<=[.;])\s+(?=[A-Z`(*])/));
}

const mentionsDiff = (sentence: string) => /\bdiffs?\b/i.test(sentence.replace(/diff coverage/gi, ""));

describe("docs: size limits", () => {
  it("AC-16: LIMITS.md has a Size limits section, THREAT-MODEL.md row A1 points to it, and the changelog says so", () => {
    const limits = read("docs/LIMITS.md");
    const sizeLimits = section(limits, /Size limits/);
    expect(sizeLimits, "docs/LIMITS.md has a section headed Size limits").not.toBeNull();
    const body = sizeLimits ?? "";
    for (const [input, pattern] of [
      ["the diff", /\bdiff\b/i],
      ["lcov", /\blcov\b/i],
      ["Cobertura", /\bCobertura\b/],
      ["the config", /\bconfig(uration)?\b/i],
      ["the git ls-files output", /git ls-files/],
    ] as const) {
      expect(pattern.test(body), `Size limits names ${input}`).toBe(true);
    }
    // No sentence of LIMITS.md says the diff is limited to 256 MiB any more: the 256 MiB buffer is stated only for
    // the git output that keeps it (`git ls-files`, `git ls-tree`), never for the diff or for git output at large.
    expect(sentences(limits).filter((sentence) => /256\s*MiB/.test(sentence) && mentionsDiff(sentence))).toEqual([]);
    expect(blocks(limits).filter((block) => /256\s*MiB/.test(block) && !/git ls-(files|tree)/.test(block))).toEqual([]);

    const threatModel = read("docs/THREAT-MODEL.md");
    const a1 = threatModel.split("\n").find((line) => /^\|\s*A1\s*\|/.test(line));
    expect(a1, "THREAT-MODEL.md has row A1").toBeDefined();
    const row = a1 ?? "";
    const residual = row.slice(row.indexOf("**Residual:**"));
    expect(row).toContain("**Residual:**");
    expect(residual).not.toMatch(/git's 256 MiB buffer/);
    expect(sentences(residual).filter((sentence) => /256\s*MiB/.test(sentence) && mentionsDiff(sentence))).toEqual([]);
    expect(residual).toContain("Size limits");

    const changelog = read("CHANGELOG.md");
    // The change shipped in 0.1.0; before that release its line sat under Unreleased.
    const shipped = section(changelog, /^\[0\.1\.0\]/);
    expect(shipped, "CHANGELOG.md has a 0.1.0 section").not.toBeNull();
    expect(shipped ?? "").toMatch(/the diff and lcov coverage are read line by line/i);
  });
});
