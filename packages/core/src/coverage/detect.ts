import type { CoverageFormat, CoverageFormatSelection } from "./types.js";
import { scanXml, type XmlEvent } from "./xml.js";

/** What a coverage file looks like: a supported format, an unrecognized one, or nothing at all. */
export type DetectedCoverageFormat = CoverageFormat | "unknown" | "empty";

export interface CoverageFormatChoice {
  format: DetectedCoverageFormat;
  /** `configured` when the user named the format; `auto-detected` when it was read from the file. */
  how: "configured" | "auto-detected";
}

/** Only this many characters after an optional BOM are ever read; the rest of the file is never looked at. */
const DETECTION_WINDOW = 1024;

/**
 * How many characters of a file decide its format on their own: a BOM, the window, and one more character, which
 * tells a text that ends at the window from one that goes on. `detectCoverageFormat` of a prefix this long (or of
 * the whole text when that is shorter) equals `detectCoverageFormat` of the whole text.
 */
export const DETECTION_PREFIX = 1 + DETECTION_WINDOW + 1;

function isSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

/**
 * Tell lcov, Cobertura XML and anything else apart by the first 1 KiB of the text.
 *
 * The text may be hostile, so the work is bounded by the window whatever its size: lcov is a
 * prefix check, and XML goes through the same regex-free scanner the Cobertura parser uses.
 * Never throws.
 *
 * - lcov: the first non-whitespace content starts with `TN:` or `SF:`.
 * - Cobertura: the root element is named exactly `coverage`, has no `clover` attribute, and its
 *   first child (if the window shows one) is not `project`, which is the Clover shape.
 * - `empty`: only whitespace, and the whole text fits in the window.
 * - `unknown`: everything else, including a root start tag that does not end within the window.
 */
export function detectCoverageFormat(text: string): DetectedCoverageFormat {
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const end = start + DETECTION_WINDOW;
  const window = text.slice(start, end);

  let first = 0;
  while (first < window.length && isSpace(window.charAt(first))) first++;
  if (first === window.length) return end >= text.length ? "empty" : "unknown";

  if (window.startsWith("TN:", first) || window.startsWith("SF:", first)) return "lcov";
  if (window.charAt(first) !== "<") return "unknown";

  return detectXml(window.slice(first));
}

function detectXml(window: string): DetectedCoverageFormat {
  let decided: DetectedCoverageFormat | undefined;
  let seenRoot = false;

  scanXml(window, (event: XmlEvent) => {
    if (decided !== undefined) return;
    if (!seenRoot) {
      if (event.type === "text") {
        if (event.text.trim() !== "") decided = "unknown";
      } else if (event.type === "end") {
        decided = "unknown";
      } else if (event.name !== "coverage" || event.attrs.has("clover")) {
        decided = "unknown";
      } else if (event.selfClosing) {
        decided = "cobertura";
      } else {
        seenRoot = true;
      }
      return;
    }
    if (event.type === "text") return;
    decided = event.type === "start" && event.name === "project" ? "unknown" : "cobertura";
  });

  if (decided !== undefined) return decided;
  // No root in the window: unknown. A root with no child in the window and no `clover` attribute: Cobertura.
  return seenRoot ? "cobertura" : "unknown";
}

/**
 * Settle on a format for `text`. An explicit selection is taken as given, without looking at the
 * text; `auto` detects it.
 */
export function chooseCoverageFormat(text: string, selection: CoverageFormatSelection): CoverageFormatChoice {
  if (selection === "auto") return { format: detectCoverageFormat(text), how: "auto-detected" };
  return { format: selection, how: "configured" };
}

/** The one line the CLI and the Action print so a reader can see which format was used and why. */
export function coverageChoiceLine(choice: CoverageFormatChoice): string {
  return `coverage: ${choice.format} (${choice.how})`;
}
