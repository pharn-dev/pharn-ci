import type { CoverageMap, ParseCoverageOptions } from "./types.js";

/** Cobertura XML support is planned for milestone M3. */
export function parseCobertura(_text: string, _options: ParseCoverageOptions = {}): CoverageMap {
  throw new Error("Cobertura coverage format: not implemented (M3)");
}
