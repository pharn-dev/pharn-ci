import { describe, expect, it } from "vitest";

// redactSecrets(), redactMessage(), truncateUtf8() and MESSAGE_MAX_BYTES are loaded inside each test body: the AC
// tests are written before the redaction module exists, so nothing the build adds may run while the file loads.
//
// No complete secret is written in this file (gitleaks, GitHub push protection, and AC-22 runs findSecretSpans over
// this file as committed). Every secret is assembled at test time from a prefix and a run cut from ALPHABET.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const UPPER_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** `n` distinct characters of `from`, stepping 7 places from `seed` (7 is coprime with 62 and 36). */
function cut(n: number, seed: number, from = ALPHABET): string {
  let s = "";
  for (let i = 0; i < n; i++) s += from[(seed + i * 7) % from.length];
  return s;
}

function keyLine(kind: "BEGIN" | "END"): string {
  return `-----${kind} RSA PRIVATE` + " KEY-----";
}

const COLON_SLASHES = ":" + "//";

interface Redaction {
  redactSecrets(text: string): string;
  redactMessage(text: string, maxBytes?: number): string;
  truncateUtf8(text: string, maxBytes: number): string;
  MESSAGE_MAX_BYTES: number;
}

async function load(): Promise<Redaction> {
  return (await import("../src/index.js")) as unknown as Redaction;
}

/** UTF-8 length counted by code point; a lone surrogate counts 3 bytes (what U+FFFD replacement writes). */
function utf8Bytes(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const next = text.charCodeAt(i + 1);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

const SUFFIX = /…\[\+(\d+) bytes\]$/;
const suffixFor = (dropped: number) => `…[+${dropped} bytes]`;

/** The length in UTF-16 units of the code point starting at `i`. */
function codePointUnits(text: string, i: number): number {
  const c = text.charCodeAt(i);
  const next = text.charCodeAt(i + 1);
  return c >= 0xd800 && c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? 2 : 1;
}

/** Asserts that `result` is truncateUtf8(text, budget) as the SPEC defines it. */
function expectTruncation(text: string, budget: number, result: string, label: string): void {
  const total = utf8Bytes(text);
  if (total <= budget) {
    expect(result, `${label}: within the budget, unchanged`).toBe(text);
    return;
  }
  const m = SUFFIX.exec(result);
  expect(m, `${label}: ends with …[+N bytes]`).not.toBeNull();
  const prefix = result.slice(0, result.length - (m as RegExpExecArray)[0].length);
  expect(text.startsWith(prefix), `${label}: a prefix of the text`).toBe(true);
  // A code-point boundary: the prefix never ends inside a surrogate pair of the text.
  if (prefix.length > 0) {
    const last = prefix.charCodeAt(prefix.length - 1);
    const following = text.charCodeAt(prefix.length);
    const splitsPair = last >= 0xd800 && last <= 0xdbff && following >= 0xdc00 && following <= 0xdfff;
    expect(splitsPair, `${label}: no surrogate pair is split`).toBe(false);
  }
  const dropped = total - utf8Bytes(prefix);
  expect(Number((m as RegExpExecArray)[1]), `${label}: N is the number of dropped bytes`).toBe(dropped);
  expect(utf8Bytes(result), `${label}: the result fits the budget`).toBeLessThanOrEqual(budget);
  // The longest such prefix: one more code point no longer fits with its own suffix.
  const longer = text.slice(0, prefix.length + codePointUnits(text, prefix.length));
  const longerTotal = utf8Bytes(longer) + utf8Bytes(suffixFor(total - utf8Bytes(longer)));
  expect(longerTotal, `${label}: one more code point would not fit`).toBeGreaterThan(budget);
}

describe("redaction", () => {
  it("AC-5: replaces each S01 to S09 secret with its own [redacted:S0x] and the S10 value with [redacted], leaving the words", async () => {
    const { redactSecrets, redactMessage } = await load();
    const block = `${keyLine("BEGIN")}\n${cut(60, 15)}\n${cut(40, 16)}\n${keyLine("END")}`;
    const segments: Array<string | [id: string, secret: string]> = [
      "alpha ",
      ["S01", "ghp" + "_" + cut(36, 1)],
      " bravo\ncharlie ",
      ["S02", "sk-" + "ant-" + "api03-" + cut(32, 4)],
      " delta\necho ",
      ["S03", "sk-" + "proj-" + cut(30, 5)],
      " foxtrot\ngolf ",
      ["S04", "AI" + "za" + cut(35, 7)],
      " hotel\nindia ",
      ["S05", "AK" + "IA" + cut(16, 8, UPPER_DIGITS)],
      " juliet\nkilo ",
      ["S06", "xo" + "xb-" + cut(12, 9) + "-" + cut(12, 10)],
      " lima\nmike ",
      ["S07", "sk" + "_live_" + cut(24, 11)],
      ` november\noscar https${COLON_SLASHES}deploy:`,
      ["S09", cut(16, 12)],
      '@db.internal.io/app papa\nquebec {"api' + 'Key": "',
      ["S10", cut(28, 14)],
      '"} romeo\nsierra\n',
      ["S08", block],
      "\ntango uniform\n",
    ];
    const text = segments.map((s) => (typeof s === "string" ? s : s[1])).join("");
    const expected = segments
      .map((s) => (typeof s === "string" ? s : s[0] === "S10" ? "[redacted]" : `[redacted:${s[0]}]`))
      .join("");
    expect(utf8Bytes(text), "control: the seeded text fits the default message budget").toBeLessThan(2048);

    const redacted = redactSecrets(text);
    const message = redactMessage(text);
    expect(redacted).toBe(expected);
    expect(message).toBe(expected);
    for (const s of segments) {
      if (typeof s === "string") continue;
      expect(redacted.includes(s[1]), `redactSecrets leaves no ${s[0]} secret`).toBe(false);
      expect(message.includes(s[1]), `redactMessage leaves no ${s[0]} secret`).toBe(false);
    }
  });

  it("AC-6: truncateUtf8 keeps text within the budget, else cuts at a code-point boundary with …[+N bytes], and refuses a bad budget", async () => {
    const { truncateUtf8 } = await load();
    const texts: Array<[string, string]> = [
      ["ASCII", "abcdefghij".repeat(10)],
      ["two-byte", "zażółć gęślą jaźń ".repeat(4)],
      ["three-byte", "€₹…→".repeat(12)],
      ["four-byte", "a🙂b😀".repeat(12)],
      ["lone surrogate", "a\uD800b\uDC00".repeat(12)],
      ["mixed", "x€🙂ż\uD800".repeat(8)],
    ];
    for (const [label, text] of texts) {
      const total = utf8Bytes(text);
      expect(total, `control: ${label} is longer than the smallest budget`).toBeGreaterThan(40);
      for (const budget of [32, 33, 34, 35, 36, total - 7, total - 3, total - 1, total, total + 1, total + 50]) {
        expectTruncation(text, budget, truncateUtf8(text, budget), `${label} at ${budget} of ${total} bytes`);
      }
    }

    // A lone surrogate counts 3 bytes: 20 of them are 60 bytes, so 60 keeps them all and 59 does not.
    const lone = "\uD800".repeat(20);
    expect(truncateUtf8(lone, 60)).toBe(lone);
    expect(truncateUtf8(lone, 59)).not.toBe(lone);
    expectTruncation(lone, 59, truncateUtf8(lone, 59), "20 lone surrogates at 59 bytes");

    // A surrogate pair is never split, whatever the budget.
    const pairs = "🙂".repeat(30);
    for (let budget = 32; budget <= 60; budget++) {
      const out = truncateUtf8(pairs, budget);
      const prefix = out.replace(SUFFIX, "");
      expect(prefix.length % 2, `pairs at ${budget}`).toBe(0);
    }

    for (const bad of [31, 2.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => truncateUtf8("some text", bad), `budget ${bad}`).toThrow(RangeError);
    }
  });

  it("AC-7: redactMessage redacts before it cuts to MESSAGE_MAX_BYTES (2048), so a secret across the cut leaves nothing", async () => {
    const { redactMessage, MESSAGE_MAX_BYTES } = await load();
    expect(MESSAGE_MAX_BYTES).toBe(2048);

    const secret = "ghp" + "_" + cut(36, 30);
    const filler = "lorem ipsum dolor sit amet ";
    const head = filler.repeat(80).slice(0, 2030);
    const text = `${head} ${secret} ${filler.repeat(80)}`.slice(0, 3000);
    expect(utf8Bytes(text), "control: the text is 3000 bytes").toBe(3000);
    const at = text.indexOf(secret);
    expect(at < 2048 && at + secret.length > 2048, "control: the secret straddles byte 2048").toBe(true);

    const out = redactMessage(text);
    expect(utf8Bytes(out)).toBeLessThanOrEqual(2048);
    expect(out).toMatch(SUFFIX);
    expect(out.includes(secret)).toBe(false);
    expect(out.includes(secret.slice(0, 4)), "no 4-character prefix of the secret").toBe(false);
  });
});
