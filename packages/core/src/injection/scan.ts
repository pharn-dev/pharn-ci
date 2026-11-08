import type { DiffFile } from "../diff/unified.js";
import type { InjectionSignalId } from "../policy/types.js";
import { byCodeUnit } from "../text.js";
import {
  anyGlob,
  DEFAULT_EXEMPT,
  DEFAULT_PI03_EXEMPT,
  instructionKindOf,
  isDefaultExemptPath,
  isMarkdownPath,
  isProsePath,
  LOCALE_PATHS,
  vendoredInstruction,
} from "./paths.js";
import {
  BUILT_IN_MATCHERS,
  firstPhrase,
  normalizeForPhrases,
  type PhraseMatcher,
  policyPhraseMatchers,
} from "./phrases.js";
import type { InjectionSettings, InjectionSeverity } from "./policy.js";
import { scanInvisible } from "./unicode.js";

/**
 * The prompt-injection surface scan: what a pull request adds that targets the next agent reading the repository. It
 * reads only the added lines of the diff (`DiffFile.addedText`) and the changed paths; nothing else is read. Text-only
 * and deterministic: no model, no regex over a line (code point checks, `indexOf` and run-length counts).
 */

/** One finding before severities: the signal, the file, the 1-based head line (null for PI05) and fixed words. */
export interface InjectionFinding {
  id: InjectionSignalId;
  path: string;
  line: number | null;
  detail: string;
}

/** One finding as the report carries it. */
export interface InjectionSignal extends InjectionFinding {
  severity: InjectionSeverity;
}

/** Findings of one signal and file that the cap left out of the report. */
export interface OmittedInjection {
  id: InjectionSignalId;
  path: string;
  count: number;
}

/** The longest base64 or hex run PI04 accepts; a longer one is a finding. */
export const MAX_BLOB_CHARS = 200;
/** Most findings of one signal in one file that the report lists; the rest are counted. */
export const MAX_INJECTION_FINDINGS_PER_FILE = 20;
/** Most findings the report lists in all; the rest are counted. */
export const MAX_INJECTION_FINDINGS = 200;

/**
 * The files whose full added text the diff reader keeps for the scan: every file but the default exemptions
 * (`fixtures/**`, `**\/__fixtures__/**`, `**\/testdata/**`, `**\/*.test.*`, `**\/*.spec.*`), judged by the new path.
 */
export function keepInjectionText(file: { path: string; oldPath: string }): boolean {
  return !isDefaultExemptPath(file.path);
}

/** The hidden parts of one Markdown line, and whether an HTML comment is still open at its end. */
interface HiddenParts {
  parts: { text: string; where: string }[];
  inComment: boolean;
}

/** Up to three spaces, then `[label]:`: a Markdown reference definition (its label, URL and title never render). */
function isReferenceDefinition(text: string): boolean {
  let i = 0;
  while (i < 3 && text[i] === " ") i++;
  if (text[i] !== "[") return false;
  const close = text.indexOf("]:", i + 1);
  return close > i;
}

/** The title of each inline link or image on the line: the quoted part inside `](...)`. */
function linkTitles(text: string): string[] {
  const titles: string[] = [];
  for (let at = text.indexOf("]("); at !== -1; at = text.indexOf("](", at + 2)) {
    const end = text.indexOf(")", at + 2);
    const inner = end === -1 ? text.slice(at + 2) : text.slice(at + 2, end);
    let quote = -1;
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '"' || inner[i] === "'") {
        quote = i;
        break;
      }
    }
    if (quote !== -1) titles.push(inner.slice(quote + 1));
    if (end === -1) break;
  }
  return titles;
}

/**
 * The text of a Markdown line a reader does not see rendered: the inside of HTML comments (one opened on an earlier
 * consecutive added line included), a whole reference definition, and link titles. `indexOf` only.
 */
function hiddenParts(text: string, inComment: boolean): HiddenParts {
  const parts: HiddenParts["parts"] = [];
  let open = inComment;
  let from = 0;
  for (;;) {
    if (open) {
      const end = text.indexOf("-->", from);
      if (end === -1) {
        parts.push({ text: text.slice(from), where: "an HTML comment" });
        break;
      }
      parts.push({ text: text.slice(from, end), where: "an HTML comment" });
      open = false;
      from = end + 3;
      continue;
    }
    const start = text.indexOf("<!--", from);
    if (start === -1) break;
    open = true;
    from = start + 4;
  }
  if (isReferenceDefinition(text)) parts.push({ text, where: "a reference definition" });
  for (const title of linkTitles(text)) parts.push({ text: title, where: "a link title" });
  return { parts, inComment: open };
}

/** The line without its indentation and leading Markdown quote, list and heading markers. */
function withoutLineMarkers(text: string): string {
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === " " || ch === "\t" || ch === ">" || ch === "-" || ch === "*" || ch === "+" || ch === "#") {
      i++;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < text.length && (text[j] as string) >= "0" && (text[j] as string) <= "9") j++;
      if (text[j] === "." || text[j] === ")") {
        i = j + 1;
        continue;
      }
    }
    break;
  }
  return text.slice(i);
}

function isBlobChar(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x2b ||
    code === 0x2f ||
    code === 0x3d ||
    code === 0x2d ||
    code === 0x5f
  );
}

function isHexChar(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);
}

/**
 * The longest run of base64 or hex characters (letters, digits, `+`, `/`, `=`, `-`, `_`) on the line that is longer
 * than `MAX_BLOB_CHARS` and holds at least one letter and one digit, or null. One pass, no backtracking.
 */
export function longestBlob(text: string): { length: number; hex: boolean } | null {
  let bestLength = 0;
  let bestHex = false;
  let start = -1;
  let letter = false;
  let digit = false;
  let hex = true;
  for (let i = 0; i <= text.length; i++) {
    const code = i < text.length ? text.charCodeAt(i) : -1;
    if (code !== -1 && isBlobChar(code)) {
      if (start === -1) {
        start = i;
        letter = false;
        digit = false;
        hex = true;
      }
      if (code >= 0x30 && code <= 0x39) digit = true;
      else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) letter = true;
      if (!isHexChar(code)) hex = false;
    } else if (start !== -1) {
      const length = i - start;
      if (length > MAX_BLOB_CHARS && letter && digit && length > bestLength) {
        bestLength = length;
        bestHex = hex;
      }
      start = -1;
    }
  }
  return bestLength === 0 ? null : { length: bestLength, hex: bestHex };
}

/** The effective path checks of a run: the default and policy exemptions. */
interface PathRules {
  exempt: (path: string) => boolean;
  pi03Exempt: (path: string) => boolean;
  locale: (path: string) => boolean;
}

function pathRules(extraExempt: readonly string[]): PathRules {
  const exempt = anyGlob([...DEFAULT_EXEMPT, ...extraExempt]);
  const pi03Only = anyGlob(DEFAULT_PI03_EXEMPT);
  const locale = anyGlob(LOCALE_PATHS);
  return { exempt, pi03Exempt: (path) => pi03Only(path) || locale(path), locale };
}

const ALL_SCOPES = ["any", "line-start", "hidden"] as const;

/**
 * Every finding of the diff, sorted by signal id, path and line, and the files whose added text was cut (sorted). One
 * finding per signal and line at most:
 * PI01 names the first flagged character and the count, PI02 and PI03 the lowest phrase id, PI04 the longest run.
 * PI03 is not reported on a line where PI02 already reported the phrase. A deleted or binary file, and one the
 * exemptions cover, has none.
 */
export function scanInjection(
  diff: readonly DiffFile[],
  options: { exempt?: readonly string[]; phrases?: readonly string[] } = {},
): { findings: InjectionFinding[]; cut: string[] } {
  const rules = pathRules(options.exempt ?? []);
  const matchers: PhraseMatcher[] = [...BUILT_IN_MATCHERS, ...policyPhraseMatchers(options.phrases ?? [])];
  const findings: InjectionFinding[] = [];
  const cut = new Set<string>();
  for (const file of diff) {
    if (file.status === "deleted" || file.binary === true) continue;
    const { path } = file;
    if (rules.exempt(path)) continue;
    const vendored = vendoredInstruction(path);
    if (
      vendored !== null &&
      (file.status === "added" || (file.status === "renamed" && vendoredInstruction(file.oldPath) === null))
    ) {
      findings.push({ id: "PI05", path, line: null, detail: `${vendored.kind} file under ${vendored.dir}/` });
    }
    const lines = file.addedText;
    if (lines === undefined) continue;
    if (file.addedTextCut === true) cut.add(path);
    const locale = rules.locale(path);
    const pi03 = !rules.pi03Exempt(path);
    const markdown = isMarkdownPath(path);
    const prose = isProsePath(path);
    const instruction = instructionKindOf(path) !== null;
    let inComment = false;
    let previous = -1;
    for (const { line, text } of lines) {
      if (line !== previous + 1) inComment = false;
      previous = line;
      const invisible = scanInvisible(text, { bomAllowed: line === 1, locale });
      if (invisible !== null) {
        const more = invisible.count > 1 ? ` and ${invisible.count - 1} more` : "";
        findings.push({ id: "PI01", path, line, detail: `${invisible.first}${more}` });
      }
      let hidden = false;
      if (markdown) {
        const found = hiddenParts(text, inComment);
        inComment = found.inComment;
        for (const part of found.parts) {
          const phrase = firstPhrase(normalizeForPhrases(part.text), matchers, {
            scopes: ALL_SCOPES,
            lineStart: false,
          });
          if (phrase !== null) {
            findings.push({ id: "PI02", path, line, detail: `phrase ${phrase.id} in ${part.where}` });
            hidden = true;
            break;
          }
        }
      }
      if (pi03 && !hidden) {
        const anywhere = firstPhrase(normalizeForPhrases(text), matchers, { scopes: ["any"], lineStart: false });
        const atStart =
          anywhere === null && prose
            ? firstPhrase(normalizeForPhrases(withoutLineMarkers(text)), matchers, {
                scopes: ["line-start"],
                lineStart: true,
              })
            : null;
        const phrase = anywhere ?? atStart;
        if (phrase !== null) findings.push({ id: "PI03", path, line, detail: `phrase ${phrase.id}` });
      }
      if (instruction) {
        const blob = longestBlob(text);
        if (blob !== null) {
          findings.push({
            id: "PI04",
            path,
            line,
            detail: `${blob.hex ? "hex" : "base64"} run of ${blob.length} characters`,
          });
        }
      }
    }
  }
  return { findings: sortFindings(findings), cut: [...cut].sort(byCodeUnit) };
}

/** Findings sorted by signal id, then path, then line (none first), in code-unit order. */
function sortFindings<T extends InjectionFinding>(findings: T[]): T[] {
  return findings.sort((a, b) => byCodeUnit(a.id, b.id) || byCodeUnit(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0));
}

/**
 * The scan of a run with its settings applied: each finding gets its signal's severity (a signal switched off drops
 * its findings), then at most `MAX_INJECTION_FINDINGS_PER_FILE` per signal and file and `MAX_INJECTION_FINDINGS` in all
 * are kept, in id, path and line order; the rest are counted per signal and file. `cut` names the files whose added
 * text ran past the reader's bounds.
 */
export function detectInjection(
  diff: readonly DiffFile[],
  settings: InjectionSettings,
): { signals: InjectionSignal[]; omitted: OmittedInjection[]; cut: string[] } {
  const scan = scanInjection(diff, { exempt: settings.exempt, phrases: settings.phrases });
  const kept: InjectionSignal[] = [];
  const omitted = new Map<string, OmittedInjection>();
  const perFile = new Map<string, number>();
  const count = (finding: InjectionFinding): void => {
    const key = `${finding.id}\u0000${finding.path}`;
    const entry = omitted.get(key);
    if (entry === undefined) omitted.set(key, { id: finding.id, path: finding.path, count: 1 });
    else entry.count++;
  };
  for (const finding of scan.findings) {
    const severity = settings.severities[finding.id];
    if (severity === null) continue;
    const key = `${finding.id}\u0000${finding.path}`;
    const seen = perFile.get(key) ?? 0;
    if (seen >= MAX_INJECTION_FINDINGS_PER_FILE || kept.length >= MAX_INJECTION_FINDINGS) {
      count(finding);
      continue;
    }
    perFile.set(key, seen + 1);
    kept.push({ ...finding, severity });
  }
  return { signals: kept, omitted: [...omitted.values()], cut: scan.cut };
}
