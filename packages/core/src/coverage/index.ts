import { parseCobertura } from "./cobertura.js";
import { parseLcov } from "./lcov.js";
import type { CoverageFormat, CoverageMap, ParseCoverageOptions } from "./types.js";

export function parseCoverage(text: string, format: CoverageFormat, options: ParseCoverageOptions = {}): CoverageMap {
  switch (format) {
    case "lcov":
      return parseLcov(text, options);
    case "cobertura":
      return parseCobertura(text, options);
  }
}
