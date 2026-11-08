/**
 * The phrase list of the prompt-injection scan (PI02, PI03), versioned with the repository. Each phrase has a stable id
 * that a finding names instead of the line text. The words are stored apart and joined at load time, so this file
 * never holds a phrase as one run of text and the scan does not flag its own source.
 *
 * - `any`: a known injection phrase, PI03 in an added line of any text file (outside the PI03 exemptions), and PI02
 *   inside hidden Markdown.
 * - `line-start`: PI03 only when the phrase starts the line (after indentation and Markdown quote or list markers), and
 *   only in prose files (Markdown, plain text, reStructuredText, AsciiDoc, files without an extension); PI02 inside
 *   hidden Markdown wherever it stands.
 * - `hidden`: a phrase that addresses an agent; PI02 only, inside an HTML comment, a link title or a reference
 *   definition of a Markdown file. Visible text may say these words.
 *
 * Matching is case-insensitive, runs of white space count as one space, zero-width characters and soft hyphens are
 * dropped first, curly apostrophes count as `'`, and a phrase that starts or ends with a letter or digit must not touch
 * another letter or digit there. It uses `indexOf`, never a regex.
 */

import { byCodeUnit } from "../text.js";

/** The version of the phrase list; raised whenever a phrase is added or changed. Ids are never reused. */
export const INJECTION_PHRASES_VERSION = 1;

export type PhraseScope = "any" | "line-start" | "hidden";

export interface InjectionPhrase {
  /** `PH01`, `PH02`, ...; stable. */
  id: string;
  /** The phrase, lower case, single-spaced. */
  text: string;
  scope: PhraseScope;
}

const w = (...words: string[]): string => words.join(" ");

/** The built-in phrases, in id order. */
export const INJECTION_PHRASES: readonly InjectionPhrase[] = [
  { id: "PH01", text: w("ignore", "previous", "instructions"), scope: "any" },
  { id: "PH02", text: w("ignore", "all", "previous", "instructions"), scope: "any" },
  { id: "PH03", text: w("ignore", "prior", "instructions"), scope: "any" },
  { id: "PH04", text: w("ignore", "all", "prior", "instructions"), scope: "any" },
  { id: "PH05", text: w("ignore", "the", "previous", "instructions"), scope: "any" },
  // Perez and Ribeiro, "Ignore Previous Prompt: Attack Techniques For Language Models" (2022), goal hijacking.
  { id: "PH06", text: w("ignore", "any", "previous", "and", "following", "instructions"), scope: "any" },
  // The prompt-injection example Riley Goodside published in September 2022.
  { id: "PH07", text: w("ignore", "the", "above", "directions"), scope: "any" },
  { id: "PH08", text: w("disregard", "the", "above"), scope: "any" },
  { id: "PH09", text: w("disregard", "previous", "instructions"), scope: "any" },
  { id: "PH10", text: w("disregard", "all", "previous", "instructions"), scope: "any" },
  { id: "PH11", text: w("forget", "all", "previous", "instructions"), scope: "any" },
  { id: "PH12", text: w("forget", "your", "instructions"), scope: "any" },
  { id: "PH13", text: w("you", "are", "now", "a"), scope: "any" },
  { id: "PH14", text: w("you", "are", "now", "an"), scope: "any" },
  { id: "PH15", text: w("new", "instructions:"), scope: "any" },
  { id: "PH16", text: w("do", "not", "tell", "the", "user"), scope: "any" },
  { id: "PH17", text: w("don't", "tell", "the", "user"), scope: "any" },
  { id: "PH18", text: w("without", "telling", "the", "user"), scope: "any" },
  { id: "PH19", text: w("developer", "mode", "enabled"), scope: "any" },
  { id: "PH20", text: w("act", "as", "an", "unrestricted"), scope: "any" },
  { id: "PH21", text: ["<|im", "_start|>"].join(""), scope: "any" },
  { id: "PH22", text: ["system", ":"].join(""), scope: "line-start" },
  { id: "PH23", text: w("if", "you", "are", "an", "ai"), scope: "hidden" },
  { id: "PH24", text: w("if", "you", "are", "an", "llm"), scope: "hidden" },
  { id: "PH25", text: w("if", "you", "are", "a", "language", "model"), scope: "hidden" },
  { id: "PH26", text: w("ai", "agents", "must"), scope: "hidden" },
  { id: "PH27", text: w("ai", "agents", "should"), scope: "hidden" },
  { id: "PH28", text: w("ai", "assistants", "must"), scope: "hidden" },
  { id: "PH29", text: w("instructions", "for", "ai"), scope: "hidden" },
  { id: "PH30", text: w("instructions", "for", "the", "agent"), scope: "hidden" },
  { id: "PH31", text: w("note", "to", "ai"), scope: "hidden" },
  { id: "PH32", text: w("attention", "ai"), scope: "hidden" },
];

/** The most org-policy phrases the scan matches; the rest of `injection.phrases` is not used. */
export const MAX_POLICY_PHRASES = 100;

/** A phrase as the matcher uses it: its id, its normalized text and where it counts. */
export interface PhraseMatcher {
  id: string;
  text: string;
  scope: PhraseScope;
  /** Whether the first and the last character are letters or digits, so the match needs a boundary there. */
  edgeStart: boolean;
  edgeEnd: boolean;
}

/** Zero-width characters and the soft hyphen, dropped before matching: U+00AD, U+200B to U+200D, U+2060, U+FEFF. */
function isDropped(code: number): boolean {
  return code === 0x00ad || (code >= 0x200b && code <= 0x200d) || code === 0x2060 || code === 0xfeff;
}

/** White space as ECMAScript `\s` defines it, by code unit. */
function isSpace(code: number): boolean {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/**
 * The text as phrases are matched against it: zero-width characters and soft hyphens dropped, every run of white space
 * one space, curly apostrophes (U+2018, U+2019) as `'`, lower case, trimmed. Linear in the text.
 */
export function normalizeForPhrases(text: string): string {
  let out = "";
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isDropped(code)) continue;
    if (isSpace(code)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out += " ";
      pendingSpace = false;
    }
    out += code === 0x2018 || code === 0x2019 ? "'" : text[i];
  }
  return out.toLowerCase();
}

const WORD_CHAR = /^[\p{L}\p{N}]$/u;

/** Whether the code point at `index` of `text` (or the one that ends before it, `before`) is a letter or digit. */
function wordAt(text: string, index: number, before: boolean): boolean {
  if (before) {
    if (index <= 0) return false;
    const low = text.charCodeAt(index - 1);
    const start = low >= 0xdc00 && low <= 0xdfff && index >= 2 ? index - 2 : index - 1;
    const cp = text.codePointAt(start);
    return cp !== undefined && WORD_CHAR.test(String.fromCodePoint(cp));
  }
  if (index >= text.length) return false;
  const cp = text.codePointAt(index);
  return cp !== undefined && WORD_CHAR.test(String.fromCodePoint(cp));
}

/** A matcher for a phrase text (already normalized). */
export function phraseMatcher(id: string, text: string, scope: PhraseScope): PhraseMatcher {
  return {
    id,
    text,
    scope,
    edgeStart: text.length > 0 && wordAt(text, 0, false),
    edgeEnd: text.length > 0 && wordAt(text, text.length, true),
  };
}

/** The built-in phrases as matchers, in id order. */
export const BUILT_IN_MATCHERS: readonly PhraseMatcher[] = INJECTION_PHRASES.map((phrase) =>
  phraseMatcher(phrase.id, phrase.text, phrase.scope),
);

/**
 * The org policy's extra phrases (`injection.phrases`) as matchers of scope `any`: each normalized, empty ones and
 * repeats dropped, sorted in code-unit order, the first `MAX_POLICY_PHRASES` kept and named `PX01`, `PX02`, ... in that
 * order, so the same list always gives the same ids. A finding names the id, never the phrase.
 */
export function policyPhraseMatchers(phrases: readonly string[]): PhraseMatcher[] {
  const texts = [...new Set(phrases.map(normalizeForPhrases).filter((text) => text !== ""))]
    .sort(byCodeUnit)
    .slice(0, MAX_POLICY_PHRASES);
  return texts.map((text, i) => phraseMatcher(`PX${String(i + 1).padStart(2, "0")}`, text, "any"));
}

/** Whether `matcher` occurs in the normalized `text` with its boundaries; `indexOf` only, linear per phrase. */
export function phraseOccurs(text: string, matcher: PhraseMatcher): boolean {
  const needle = matcher.text;
  if (needle === "") return false;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    if (matcher.edgeStart && wordAt(text, at, true)) continue;
    if (matcher.edgeEnd && wordAt(text, at + needle.length, false)) continue;
    return true;
  }
  return false;
}

/**
 * The first matcher, in the order given, that occurs in the normalized text, or null. `atStart` limits the
 * `line-start` matchers to a match at offset 0; matchers of other scopes are matched anywhere.
 */
export function firstPhrase(
  text: string,
  matchers: readonly PhraseMatcher[],
  options: { scopes: readonly PhraseScope[]; lineStart: boolean },
): PhraseMatcher | null {
  for (const matcher of matchers) {
    if (!options.scopes.includes(matcher.scope)) continue;
    if (matcher.scope === "line-start" && options.lineStart) {
      if (text.startsWith(matcher.text) && !(matcher.edgeEnd && wordAt(text, matcher.text.length, false))) {
        return matcher;
      }
      continue;
    }
    if (phraseOccurs(text, matcher)) return matcher;
  }
  return null;
}
