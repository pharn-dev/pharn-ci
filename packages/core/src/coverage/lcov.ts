import { isAbsolutePath, joinCoverageRoot, normalizePath } from "../paths.js";
import type { CoverageMap, LineHits, ParseCoverageOptions } from "./types.js";

/**
 * Parse an lcov tracefile into a CoverageMap.
 *
 * Only `SF`, `DA` and `end_of_record` matter; every other record (TN, FN, BRDA,
 * LF, LH, ...) is ignored. A file appearing in several records is merged by
 * summing hits per line. Malformed `DA` lines are skipped. A file appears in
 * the map only when it has a valid `DA` line, as in the Cobertura parser, so a
 * report whose records carry no line data (a crashed or truncated reporter) is
 * an empty map and is reported as empty rather than passing.
 */
export function parseLcov(text: string, options: ParseCoverageOptions = {}): CoverageMap {
  return parseLcovLines(text.split(/\r?\n/), options);
}

/** Parse the lines of an lcov tracefile (already cut at line ends); same result as `parseLcov` of the joined text. */
export function parseLcovLines(lines: Iterable<string>, options: ParseCoverageOptions = {}): CoverageMap {
  const reader = createLcovReader(options);
  for (const line of lines) reader.push(line);
  return reader.finish();
}

/** Like `parseLcovLines`, for lines that arrive from a stream. A rejection of the stream rejects the promise. */
export async function parseLcovLinesAsync(
  lines: AsyncIterable<string>,
  options: ParseCoverageOptions = {},
): Promise<CoverageMap> {
  const reader = createLcovReader(options);
  for await (const line of lines) reader.push(line);
  return reader.finish();
}

/**
 * An lcov tracefile read one line at a time: `push` each line (without its line end), then `finish` for the map.
 * Memory holds the coverage map, never the text.
 */
export function createLcovReader(options: ParseCoverageOptions = {}): {
  push(line: string): void;
  finish(): CoverageMap;
} {
  const map: CoverageMap = new Map();
  let current: LineHits | undefined;

  return {
    push(raw: string): void {
      const line = raw.trim();
      if (line.startsWith("SF:")) {
        const raw = line.slice(3);
        const path =
          options.coverageRoot !== undefined && !isAbsolutePath(raw.trim())
            ? normalizePath(joinCoverageRoot(raw, options.coverageRoot), options.repoRoot)
            : normalizePath(raw, options.repoRoot);
        current = map.get(path);
        if (!current) {
          current = new Map();
          map.set(path, current);
        }
      } else if (line.startsWith("DA:") && current) {
        const [lineNo, hits] = line.slice(3).split(",");
        const n = Number(lineNo);
        const h = Number(hits);
        if (!Number.isInteger(n) || n < 1 || !Number.isFinite(h) || h < 0) return;
        current.set(n, (current.get(n) ?? 0) + h);
      } else if (line === "end_of_record") {
        current = undefined;
      }
    },
    finish(): CoverageMap {
      for (const [path, hits] of map) {
        if (hits.size === 0) map.delete(path);
      }
      return map;
    },
  };
}
