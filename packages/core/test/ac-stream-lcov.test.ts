import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";

// The line reader and the splitter are imported inside the test body: the AC tests are written before
// packages/core/src/lines.ts and the lcov line reader exist, so nothing that depends on them may run while the file
// loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

/** Every `*.info` file under fixtures/, as a path relative to it, in a stable order. */
function lcovFixtures(): string[] {
  return (readdirSync(FIXTURES, { recursive: true }) as string[])
    .map((path) => path.split("\\").join("/"))
    .filter((path) => path.endsWith(".info"))
    .sort();
}

/** Cuts `text` into chunks of `size` characters (the last one may be shorter). */
function cut(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let at = 0; at < text.length; at += size) chunks.push(text.slice(at, at + size));
  return chunks;
}

/** Every chunking AC-1 names: two chunks at every position, and chunks of 1, 2, 3 and 7 characters. */
function* chunkings(text: string): Generator<[string, string[]]> {
  for (let at = 0; at <= text.length; at++) yield [`cut at ${at}`, [text.slice(0, at), text.slice(at)]];
  for (const size of [1, 2, 3, 7]) yield [`chunks of ${size}`, cut(text, size)];
}

async function* asAsync(items: Iterable<string>): AsyncGenerator<string> {
  for (const item of items) yield item;
}

/** A canonical text form of a coverage map, for a deep comparison that does not depend on insertion order. */
const canonical = (map: Map<string, Map<number, number>>) =>
  JSON.stringify(
    [...map]
      .map(([path, hits]) => [path, [...hits].sort((a, b) => a[0] - b[0])] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  );

describe("lcov line reader", () => {
  it("AC-1: every lcov fixture, as written and with CRLF, parses line by line to what parseLcov returns", async () => {
    const { parseLcov, createLcovReader, parseLcovLines, parseLcovLinesAsync } = await import(
      "../src/coverage/lcov.js"
    );
    const { splitLines } = await import("../src/lines.js");

    const names = lcovFixtures();
    // The lcov fixtures of fixtures/lcov/, fixtures/golden*/, fixtures/coverage-multi/ and the others.
    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(names).toContain("golden/coverage.info");
    expect(names).toContain("lcov/windows.info");

    const optionSets = [undefined, { repoRoot: REPO_ROOT, coverageRoot: "packages/core" }] as const;
    const mismatches: string[] = [];
    let compared = 0;

    for (const name of names) {
      const written = fixture(name);
      for (const [variant, text] of [
        ["as written", written],
        ["CRLF", written.replace(/\n/g, "\r\n")],
      ] as const) {
        for (const options of optionSets) {
          const expected = canonical(parseLcov(text, options));
          const where = `${name} (${variant}, ${options === undefined ? "no options" : "repo and coverage root"})`;

          for (const [how, chunks] of chunkings(text)) {
            const lines = [...splitLines(chunks)];

            const reader = createLcovReader(options);
            for (const line of lines) reader.push(line);
            const results = {
              createLcovReader: reader.finish(),
              parseLcovLines: parseLcovLines(lines, options),
              parseLcovLinesAsync: await parseLcovLinesAsync(asAsync(lines), options),
            };
            for (const [api, map] of Object.entries(results)) {
              compared++;
              if (canonical(map) !== expected) mismatches.push(`${where}, ${how}: ${api}`);
            }
          }
        }
      }
    }

    expect(compared).toBeGreaterThan(1000);
    expect(mismatches.slice(0, 20)).toEqual([]);
  }, 120_000);
});
