import { fnv1a32Hex } from "../testIndex/hash.js";
import { cutCodeUnits } from "../text.js";

/** The longest test id, in UTF-16 code units. */
export const TEST_ID_MAX_UNITS = 500;

/** The hash suffix of a cut id: `~` and 8 hex digits. */
const HASH_SUFFIX_UNITS = 9;

/**
 * True for a code unit that collapses into one space: the C0 controls and space (U+0000 to U+0020), DEL and the C1
 * controls (U+007F to U+009F), and the line and paragraph separators (U+2028, U+2029). So an id never holds a control
 * character, which the app's quarantine list may not hold either.
 */
function isCollapsed(code: number): boolean {
  return code <= 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

/** The text with each run of whitespace and control characters made one space, trimmed at both ends. */
export function collapseWhitespace(text: string): string {
  let out = "";
  let pendingSpace = false;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    if (!isCollapsed(text.charCodeAt(i))) continue;
    if (i > from) {
      out += (pendingSpace && out !== "" ? " " : "") + text.slice(from, i);
      pendingSpace = false;
    }
    pendingSpace = true;
    from = i + 1;
  }
  if (text.length > from) out += (pendingSpace && out !== "" ? " " : "") + text.slice(from);
  return out;
}

/** The parts of a JUnit `<testcase>` its id is made of: its attributes and the name of the suite around it. */
export interface TestIdParts {
  classname: string;
  file: string;
  suite: string;
  name: string;
}

/**
 * The id of a test, as the report's `flaky.quarantined` and the app's quarantine list spell it: `<classname>::<name>`,
 * where the classname falls back to the `file` attribute, then to the name of the innermost enclosing `<testsuite>`;
 * when all three are empty the id is the name alone. Every part has its whitespace and control characters collapsed
 * (`collapseWhitespace`) first. An id longer than 500 UTF-16 code units is cut to 491 (one fewer when the cut would
 * split a surrogate pair) and ends in `~` and the 8 lowercase hex digits of the 32-bit FNV-1a hash of the whole id over
 * its UTF-16 code units, so it stays at most 500 and two long ids that share a prefix stay apart.
 */
export function junitTestId(parts: TestIdParts): string {
  const name = collapseWhitespace(parts.name);
  let owner = collapseWhitespace(parts.classname);
  if (owner === "") owner = collapseWhitespace(parts.file);
  if (owner === "") owner = collapseWhitespace(parts.suite);
  const id = owner === "" ? name : `${owner}::${name}`;
  if (id.length <= TEST_ID_MAX_UNITS) return id;
  return `${cutCodeUnits(id, TEST_ID_MAX_UNITS - HASH_SUFFIX_UNITS, { marker: false })}~${fnv1a32Hex(id)}`;
}
