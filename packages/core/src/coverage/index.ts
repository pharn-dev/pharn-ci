import { parseCoberturaCounted } from "./cobertura.js";
import { createLcovReader } from "./lcov.js";
import type { CoverageFormat, CoverageMap, ParseCoverageOptions, ParsedCoverage } from "./types.js";

/** Parse a coverage report of a known format, with the number of malformed records that were dropped from it. */
export function parseCoverageCounted(
  text: string,
  format: CoverageFormat,
  options: ParseCoverageOptions = {},
): ParsedCoverage {
  switch (format) {
    case "lcov": {
      const reader = createLcovReader(options);
      for (const line of text.split(/\r?\n/)) reader.push(line);
      const map = reader.finish();
      return { map, skipped: reader.skipped() };
    }
    case "cobertura":
      return parseCoberturaCounted(text, options);
  }
}

export function parseCoverage(text: string, format: CoverageFormat, options: ParseCoverageOptions = {}): CoverageMap {
  return parseCoverageCounted(text, format, options).map;
}
