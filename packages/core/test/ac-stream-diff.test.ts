import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";

// The line reader, the splitter and the fixtures are loaded inside the test body: the AC tests are written before
// packages/core/src/lines.ts, the diff line reader and fixtures/diff/header-cases.diff exist, so nothing that depends
// on them may run while the file loads.

/** Every `*.diff` file under fixtures/, as a path relative to it, in a stable order. */
function diffFixtures(): string[] {
  return (readdirSync(FIXTURES, { recursive: true }) as string[])
    .map((path) => path.split("\\").join("/"))
    .filter((path) => path.endsWith(".diff"))
    .sort();
}

/** Cuts `text` into chunks of `size` characters (the last one may be shorter). */
function cut(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let at = 0; at < text.length; at += size) chunks.push(text.slice(at, at + size));
  return chunks;
}

/** Every chunking AC-2 names: two chunks at every position, and chunks of 1, 2, 3 and 7 characters. */
function* chunkings(text: string): Generator<[string, string[]]> {
  for (let at = 0; at <= text.length; at++) yield [`cut at ${at}`, [text.slice(0, at), text.slice(at)]];
  for (const size of [1, 2, 3, 7]) yield [`chunks of ${size}`, cut(text, size)];
}

async function* asAsync(items: Iterable<string>): AsyncGenerator<string> {
  for (const item of items) yield item;
}

describe("unified diff line reader", () => {
  it("AC-2: every diff fixture, header cases included, as written and with CRLF, parses line by line to what parseUnifiedDiff returns", async () => {
    const { parseUnifiedDiff, createUnifiedDiffReader, parseUnifiedDiffLines, parseUnifiedDiffLinesAsync } =
      await import("../src/diff/unified.js");
    const { splitLines } = await import("../src/lines.js");

    const names = diffFixtures();
    expect(names).toContain("diff/header-cases.diff");
    expect(names).toContain("diff/tricky.diff");
    expect(names).toContain("golden/pr.diff");

    // The new fixture holds the header cases the other diff fixtures do not.
    const cases = fixture("diff/header-cases.diff");
    const caseLines = cases.split("\n");
    expect(cases).toContain("GIT binary patch");
    expect(cases).toContain("\\ No newline at end of file");
    expect(cases).toContain("deleted file mode");
    expect(cases).toContain("+++ /dev/null");
    // A rename between C-quoted paths with a space and an octal escape.
    expect(caseLines.some((line) => /^rename from ".* .*\\[0-7]{3}.*"$/.test(line))).toBe(true);
    expect(caseLines.some((line) => /^rename to ".* .*\\[0-7]{3}.*"$/.test(line))).toBe(true);
    // A plain diff: a `--- ` / `+++ ` header pair that no `diff --git` line introduces (walking back over git's
    // extended header lines, the first other line is not `diff --git`).
    const extendedHeader =
      /^(old mode|new mode|deleted file mode|new file mode|index |similarity index|dissimilarity index|rename from|rename to|copy from|copy to)/;
    const introducedByGit = (index: number) => {
      let at = index - 1;
      while (at >= 0 && extendedHeader.test(caseLines[at] ?? "")) at--;
      return at >= 0 && (caseLines[at] ?? "").startsWith("diff --git ");
    };
    const plainAt = caseLines.findIndex(
      (line, index) => line.startsWith("--- ") && caseLines[index + 1]?.startsWith("+++ ") && !introducedByGit(index),
    );
    expect(plainAt).toBeGreaterThanOrEqual(0);
    // An added content line carrying a lone CR, and every line ending in a bare LF.
    expect(caseLines.some((line) => line.startsWith("+") && /\r./.test(line))).toBe(true);
    expect(caseLines.some((line) => line.endsWith("\r"))).toBe(false);

    const mismatches: string[] = [];
    let compared = 0;

    for (const name of names) {
      const written = fixture(name);
      for (const [variant, text] of [
        ["as written", written],
        ["CRLF", written.replace(/\n/g, "\r\n")],
      ] as const) {
        const expected = JSON.stringify(parseUnifiedDiff(text));
        const where = `${name} (${variant})`;

        for (const [how, chunks] of chunkings(text)) {
          const lines = [...splitLines(chunks)];

          const reader = createUnifiedDiffReader();
          for (const line of lines) reader.push(line);
          const results = {
            createUnifiedDiffReader: reader.finish(),
            parseUnifiedDiffLines: parseUnifiedDiffLines(lines),
            parseUnifiedDiffLinesAsync: await parseUnifiedDiffLinesAsync(asAsync(lines)),
          };
          for (const [api, files] of Object.entries(results)) {
            compared++;
            if (JSON.stringify(files) !== expected) mismatches.push(`${where}, ${how}: ${api}`);
          }
        }
      }
    }

    expect(compared).toBeGreaterThan(1000);
    expect(mismatches.slice(0, 20)).toEqual([]);
  }, 120_000);
});
