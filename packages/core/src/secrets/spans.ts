import { isEnvReference, isPathValue, isUrlValue, type KeyValue, secretKeyValues, shannonEntropy } from "./keys.js";

/** The ten shapes of secret the scanner knows, in table order. */
export type SecretId = "S01" | "S02" | "S03" | "S04" | "S05" | "S06" | "S07" | "S08" | "S09" | "S10";

/** One secret in a text: its shape and its UTF-16 offsets (`end` is exclusive). */
export interface SecretSpan {
  id: SecretId;
  start: number;
  end: number;
}

type Range = [start: number, end: number];

/** The characters a prefixed token may not be preceded by: it would then be the tail of a longer identifier. */
const isKeyCharCode = (code: number): boolean =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 45;

/**
 * The matches of a regular expression that starts with a literal prefix, in order, minus those preceded by a letter,
 * digit, `_` or `-`. A rejected match does not hide the ones that start inside it.
 */
function prefixed(text: string, source: RegExp, accept?: (match: string) => boolean): Range[] {
  const re = new RegExp(source.source, "g");
  const found: Range[] = [];
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const start = m.index;
    const ok = (start === 0 || !isKeyCharCode(text.charCodeAt(start - 1))) && (accept === undefined || accept(m[0]));
    if (ok) found.push([start, start + m[0].length]);
    else re.lastIndex = start + 1;
  }
  return found;
}

// S01 a GitHub token, S02 an Anthropic API key, S03 an OpenAI API key, S04 a Google API key, S05 an AWS access key id,
// S06 a Slack token, S07 a Stripe live key. Each starts with a literal prefix and reads a bounded class after it.
const findS01 = (text: string): Range[] => prefixed(text, /gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,}/);
const findS02 = (text: string): Range[] => prefixed(text, /sk-ant-[A-Za-z0-9_-]{20,}/);
const findS03 = (text: string): Range[] =>
  [
    ...prefixed(text, /sk-proj-[A-Za-z0-9_-]{20,}/),
    ...prefixed(text, /sk-[A-Za-z0-9_-]{40,}/, (match) => /[0-9]/.test(match)),
  ].sort((a, b) => a[0] - b[0]);
const findS04 = (text: string): Range[] => prefixed(text, /AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/);
const findS05 = (text: string): Range[] =>
  prefixed(text, /A[KS]IA[A-Z0-9]{16}(?![A-Za-z0-9])/, (match) => !match.endsWith("EXAMPLE"));
const findS06 = (text: string): Range[] => prefixed(text, /xox[baprs]-[A-Za-z0-9-]{10,}/);
const findS07 = (text: string): Range[] => prefixed(text, /[sr]k_live_[A-Za-z0-9]{16,}/);

const PRIVATE_KEY_BEGIN = /-----BEGIN (?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED|PGP) )?PRIVATE KEY(?: BLOCK)?-----/g;
const PRIVATE_KEY_END = /-----END (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----/g;

/** S08: from a private-key BEGIN line to the end of the next private-key END line, else to the end of the text. */
function findS08(text: string): Range[] {
  const found: Range[] = [];
  const begin = new RegExp(PRIVATE_KEY_BEGIN.source, "g");
  const end = new RegExp(PRIVATE_KEY_END.source, "g");
  for (let m = begin.exec(text); m !== null; m = begin.exec(text)) {
    end.lastIndex = m.index + m[0].length;
    const close = end.exec(text);
    const stop = close === null ? text.length : close.index + close[0].length;
    found.push([m.index, stop]);
    begin.lastIndex = stop;
  }
  return found;
}

/** The most characters of a URL's authority read after `://`. */
const MAX_AUTHORITY_CHARS = 256;
/** The shortest password or query value that is a span. */
const MIN_SECRET_VALUE_CHARS = 8;
const AUTHORITY_STOPS: ReadonlySet<string> = new Set(["/", "?", "#", '"', "'", "<", ">", "`", " ", "\t", "\n", "\r"]);
const EXAMPLE_DOMAINS: readonly string[] = ["example.com", "example.org", "example.net"];

/** Whether a host is a local or an example one, where a literal password is a placeholder. */
function isPlaceholderHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if (name === "127.0.0.1" || name === "0.0.0.0" || name === "[::1]" || name === "::1") return true;
  return EXAMPLE_DOMAINS.some((domain) => name === domain || name.endsWith(`.${domain}`));
}

/** The password of `scheme://user:password@host` whose authority starts at `from`, or null. */
function userinfoPassword(text: string, from: number): Range | null {
  const schemeEnd = from - 3;
  if (schemeEnd <= 0 || !/[A-Za-z0-9+.-]/.test(text[schemeEnd - 1] as string)) return null;
  const limit = Math.min(text.length, from + MAX_AUTHORITY_CHARS);
  let at = -1;
  let colon = -1;
  let end = from;
  while (end < limit && !AUTHORITY_STOPS.has(text[end] as string)) {
    const c = text[end];
    if (c === "@") at = end;
    else if (c === ":" && colon === -1) colon = end;
    end++;
  }
  if (at === -1 || colon === -1 || colon >= at) return null;
  const password = text.slice(colon + 1, at);
  if (password.length < MIN_SECRET_VALUE_CHARS || isEnvReference(password)) return null;
  const hostPart = text.slice(at + 1, end);
  const hostStop = hostPart.startsWith("[") ? hostPart.indexOf("]") + 1 : hostPart.indexOf(":");
  if (isPlaceholderHost(hostStop > 0 ? hostPart.slice(0, hostStop) : hostPart)) return null;
  return [colon + 1, at];
}

const QUERY_SECRET =
  /[?&](?:access_token|auth_token|refresh_token|token|api_key|api-key|apikey|client_secret|secret|password|passwd)=([^\s&#"'<>`\\]{8,})/gi;

/** S09: the password of a URL's user information, and the value of a secret-named query parameter. */
function findS09(text: string): Range[] {
  const found: Range[] = [];
  for (let at = text.indexOf("://"); at !== -1; at = text.indexOf("://", at + 3)) {
    const password = userinfoPassword(text, at + 3);
    if (password !== null) found.push(password);
  }
  const re = new RegExp(QUERY_SECRET.source, "gi");
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const value = m[1] as string;
    if (isEnvReference(value)) continue;
    const end = m.index + m[0].length;
    found.push([end - value.length, end]);
  }
  return found.sort((a, b) => a[0] - b[0]);
}

/** The shortest secret-like value under a secret-named key. */
const MIN_S10_CHARS = 20;
/** The least entropy, in bits per character, of a secret-like value. */
const MIN_S10_ENTROPY = 3.5;
const AUTH_SCHEME = /^(?:Bearer|Basic|token) /i;

/** S10: a long, high-entropy value under a secret-named key, after an authorization scheme word. */
function findS10(_text: string, pairs: readonly KeyValue[]): Range[] {
  const found: Range[] = [];
  for (const pair of pairs) {
    if (isEnvReference(pair.value)) continue;
    const scheme = AUTH_SCHEME.exec(pair.value);
    const value = scheme === null ? pair.value : pair.value.slice(scheme[0].length);
    if (value.length < MIN_S10_CHARS || /\s/.test(value)) continue;
    if (isEnvReference(value) || isUrlValue(value) || isPathValue(value)) continue;
    if (shannonEntropy(value) < MIN_S10_ENTROPY) continue;
    const start = pair.valueEnd - value.length;
    found.push([start, pair.valueEnd]);
  }
  return found;
}

const TABLE: ReadonlyArray<readonly [SecretId, (text: string, pairs: readonly KeyValue[]) => Range[]]> = [
  ["S01", findS01],
  ["S02", findS02],
  ["S03", findS03],
  ["S04", findS04],
  ["S05", findS05],
  ["S06", findS06],
  ["S07", findS07],
  ["S08", findS08],
  ["S09", findS09],
  ["S10", findS10],
];

/**
 * Every secret in `text`, by the patterns S01 to S10 in table order. A span that overlaps one an earlier pattern
 * accepted is dropped, so no two spans overlap. The result is sorted by table order, then by start; offsets are UTF-16
 * offsets and `end` is exclusive. For S09 and S10 the span is the password or value itself, not the key or the URL.
 */
export function findSecretSpans(text: string): SecretSpan[] {
  return findSecretSpansWith(text, secretKeyValues(text));
}

/** `findSecretSpans` for a caller that already has `secretKeyValues(text)`, so the key/value walk runs once. */
export function findSecretSpansWith(text: string, pairs: readonly KeyValue[]): SecretSpan[] {
  const taken = new Uint8Array(text.length);
  const spans: SecretSpan[] = [];
  for (const [id, find] of TABLE) {
    for (const [start, end] of find(text, pairs)) {
      let free = true;
      for (let i = start; i < end; i++) {
        if (taken[i] === 1) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      taken.fill(1, start, end);
      spans.push({ id, start, end });
    }
  }
  return spans;
}
