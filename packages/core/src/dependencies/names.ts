/**
 * The allow-lists a package name or version spec must pass to appear in the report (A13). Anything else is left out of
 * the report: a name or spec that fails is never quoted, so a URL with a token in it, a control character or a long
 * string from the pull request cannot reach the report, the comment or the upload. Hand-written character checks, no
 * regular expression, so the cost is linear on any input.
 */

/** The longest package name the report carries (npm's own limit). */
export const MAX_REPORTED_NAME = 214;
/** The longest version spec the report carries. */
export const MAX_REPORTED_VERSION = 100;

const isLower = (c: number) => c >= 0x61 && c <= 0x7a;
const isUpper = (c: number) => c >= 0x41 && c <= 0x5a;
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
const isAlnum = (c: number) => isLower(c) || isUpper(c) || isDigit(c);

/** One part of an npm name (the scope or the bare name): letters, digits, `-`, `.`, `_`, `~`; not starting with `.` or `_`. */
function npmPart(part: string): boolean {
  if (part === "") return false;
  const first = part.charCodeAt(0);
  if (first === 0x2e || first === 0x5f) return false;
  for (let i = 0; i < part.length; i++) {
    const c = part.charCodeAt(i);
    if (!(isAlnum(c) || c === 0x2d || c === 0x2e || c === 0x5f || c === 0x7e)) return false;
  }
  return true;
}

/** Whether `name` is an npm package name the report may carry: `name` or `@scope/name`, at most 214 characters. */
export function isReportableNpmName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_REPORTED_NAME) return false;
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash === -1) return false;
    return npmPart(name.slice(1, slash)) && npmPart(name.slice(slash + 1));
  }
  return npmPart(name);
}

/** Whether an npm name is scoped (`@scope/name`). Scoped names are never looked up (docs/LIMITS.md). */
export function isScopedNpmName(name: string): boolean {
  return name.startsWith("@");
}

/**
 * Whether `name` is a PyPI project name the report may carry: letters, digits, `.`, `_` and `-`, starting and ending
 * with a letter or digit (PEP 508), at most 214 characters.
 */
export function isReportablePypiName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_REPORTED_NAME) return false;
  if (!isAlnum(name.charCodeAt(0)) || !isAlnum(name.charCodeAt(name.length - 1))) return false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (!(isAlnum(c) || c === 0x2e || c === 0x5f || c === 0x2d)) return false;
  }
  return true;
}

/** A PyPI name normalized as PEP 503 does: lower case, each run of `-`, `_` and `.` one `-`. */
export function normalizePypiName(name: string): string {
  let out = "";
  let run = false;
  for (const ch of name.toLowerCase()) {
    if (ch === "-" || ch === "_" || ch === ".") {
      if (!run) out += "-";
      run = true;
    } else {
      out += ch;
      run = false;
    }
  }
  return out;
}

/**
 * Whether a version spec may appear in the report: 1 to 100 characters, each a letter, a digit or one of
 * `. ^ ~ < > = * | ! , + _ -` and space. No `/`, `:`, `@` or `#`, so a URL, a git spec, an alias or a path never does.
 */
export function isReportableVersion(spec: string): boolean {
  if (spec.length === 0 || spec.length > MAX_REPORTED_VERSION) return false;
  for (let i = 0; i < spec.length; i++) {
    const c = spec.charCodeAt(i);
    if (isAlnum(c)) continue;
    if (".^~<>=*|!,+_- ".includes(spec[i] as string)) continue;
    return false;
  }
  return spec.trim() === spec;
}

/** Whether a name of the ecosystem may appear in the report. */
export function isReportableName(ecosystem: "npm" | "pypi", name: string): boolean {
  return ecosystem === "npm" ? isReportableNpmName(name) : isReportablePypiName(name);
}
