import { describe, expect, it } from "vitest";

// findSecretSpans() and redactSecrets() are loaded inside each test body: the AC tests are written before the
// redaction module exists, so nothing the build adds may run while the file loads.
//
// No complete secret is written in this file (the repository has a required gitleaks check and GitHub push
// protection, and AC-22 runs findSecretSpans over this file as committed). Every secret is assembled at test time
// from a prefix and a run of letters and digits cut from ALPHABET; the pieces alone match no pattern.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const UPPER_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** `n` distinct characters of `from`, stepping 7 places from `seed` (7 is coprime with 62 and 36). */
function cut(n: number, seed: number, from = ALPHABET): string {
  let s = "";
  for (let i = 0; i < n; i++) s += from[(seed + i * 7) % from.length];
  return s;
}

const COLON_SLASHES = ":" + "//";
const PARTS = {
  S01: "ghp" + "_" + cut(36, 1),
  S01_PAT: "github" + "_pat_" + cut(22, 2) + "_" + cut(27, 3),
  S02: "sk-" + "ant-" + "api03-" + cut(32, 4),
  S03_PROJ: "sk-" + "proj-" + cut(30, 5),
  S03_LONG: "sk-" + cut(39, 6) + "7",
  S04: "AI" + "za" + cut(35, 7),
  S05: "AK" + "IA" + cut(16, 8, UPPER_DIGITS),
  S06: "xo" + "xb-" + cut(12, 9) + "-" + cut(12, 10),
  S07: "sk" + "_live_" + cut(24, 11),
  S09_PASSWORD: cut(16, 12),
  S09_QUERY_VALUE: cut(24, 13),
  S10_VALUE: cut(28, 14),
};

/** A private-key BEGIN or END line of one form ("" is the bare form). */
function keyLine(kind: "BEGIN" | "END", form: string): string {
  const block = form === "PGP " ? " BLOCK" : "";
  return `-----${kind} ${form}PRIVATE` + ` KEY${block}-----`;
}
const KEY_BODY = `${cut(60, 15)}\n${cut(60, 16)}\n${cut(20, 17)}`;
const FORMS = ["RSA ", "EC ", "DSA ", "OPENSSH ", "ENCRYPTED ", "PGP ", ""];

type Span = { id: string; start: number; end: number };

async function load() {
  const core = (await import("../src/index.js")) as unknown as {
    findSecretSpans(text: string): Span[];
    redactSecrets(text: string): string;
  };
  const spans = (text: string) => core.findSecretSpans(text).map(({ id, start, end }) => ({ id, start, end }));
  return { spans, redactSecrets: (text: string) => core.redactSecrets(text) };
}

/** A text holding `secret` between `before` and `after`, with the secret's UTF-16 offsets. */
function place(before: string, secret: string, after: string) {
  return { text: before + secret + after, start: before.length, end: before.length + secret.length };
}

describe("findSecretSpans", () => {
  it("AC-1: finds exactly one span per complete shape, at the secret's UTF-16 offsets", async () => {
    const { spans } = await load();
    const pk = keyLine("BEGIN", "") + "\n" + KEY_BODY + "\n" + keyLine("END", "");
    const cases: Array<[string, string, ReturnType<typeof place>]> = [
      ["S01 ghp_", "S01", place("see ", PARTS.S01, " here\n")],
      ["S01 github_pat_", "S01", place("see ", PARTS.S01_PAT, " here\n")],
      ["S02", "S02", place("see ", PARTS.S02, " here\n")],
      ["S03 sk-proj-", "S03", place("see ", PARTS.S03_PROJ, " here\n")],
      ["S03 40-character sk-", "S03", place("see ", PARTS.S03_LONG, " here\n")],
      ["S04", "S04", place("see ", PARTS.S04, " here\n")],
      ["S05", "S05", place("see ", PARTS.S05, " here\n")],
      ["S06", "S06", place("see ", PARTS.S06, " here\n")],
      ["S07", "S07", place("see ", PARTS.S07, " here\n")],
      ["S08", "S08", place("before\n", pk, "\nafter\n")],
      [
        "S09 URL userinfo",
        "S09",
        place(`connect to https${COLON_SLASHES}deploy:`, PARTS.S09_PASSWORD, "@db.internal.io/app now\n"),
      ],
      [
        "S09 query parameter",
        "S09",
        place(`GET https${COLON_SLASHES}api.internal.io/v1/items?access_token=`, PARTS.S09_QUERY_VALUE, "&page=2\n"),
      ],
      ["S10", "S10", place('{"api' + 'Key": "', PARTS.S10_VALUE, '"}\n')],
      ["S10 Bearer", "S10", place('{"authori' + 'zation": "Bearer ', PARTS.S10_VALUE, '"}\n')],
      ["S10 Basic", "S10", place('{"authori' + 'zation": "Basic ', PARTS.S10_VALUE, '"}\n')],
      ["S10 token scheme", "S10", place('{"authori' + 'zation": "token ', PARTS.S10_VALUE, '"}\n')],
    ];
    for (const [label, id, { text, start, end }] of cases) {
      expect(spans(text), label).toEqual([{ id, start, end }]);
    }
  });

  it("AC-2: an sk-ant- key is S02 only, a token value that is S01 is not also S10, and spans come in table order without overlap", async () => {
    const { spans } = await load();

    const ant = place("key ", PARTS.S02, " end\n");
    expect(spans(ant.text), "sk-ant- gives S02 only").toEqual([{ id: "S02", start: ant.start, end: ant.end }]);

    const token = place('{"to' + 'ken": "', PARTS.S01, '"}\n');
    expect(spans(token.text), "an S01 value under a token key gives S01 only").toEqual([
      { id: "S01", start: token.start, end: token.end },
    ]);

    // Written in reverse table order on one line: S07, then S05, then S01.
    const line = `a ${PARTS.S07} b ${PARTS.S05} c ${PARTS.S01} d\n`;
    const found = spans(line);
    expect(
      found.map((s) => s.id),
      "table order S01 to S10",
    ).toEqual(["S01", "S05", "S07"]);
    for (const [secret, id] of [
      [PARTS.S01, "S01"],
      [PARTS.S05, "S05"],
      [PARTS.S07, "S07"],
    ] as const) {
      const start = line.indexOf(secret);
      expect(found.find((s) => s.id === id)).toEqual({ id, start, end: start + secret.length });
    }

    // Every shape in one text: table order and no two spans overlapping.
    const all = [
      `x ${PARTS.S07} ${PARTS.S06} ${PARTS.S05} ${PARTS.S04} ${PARTS.S03_PROJ} ${PARTS.S02} ${PARTS.S01} x`,
      `GET https${COLON_SLASHES}api.internal.io/v1?token=${PARTS.S09_QUERY_VALUE}&x=1`,
      '{"api' + `_key": "${PARTS.S10_VALUE}"}`,
      '{"to' + `ken": "${PARTS.S01_PAT}"}`,
    ].join("\n");
    const allSpans = spans(all);
    const order = allSpans.map((s) => s.id);
    expect(order, "sorted in table order").toEqual([...order].sort());
    expect(new Set(order), "every id once at least").toEqual(
      new Set(["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S09", "S10"]),
    );
    for (let i = 0; i < allSpans.length; i++) {
      for (let j = i + 1; j < allSpans.length; j++) {
        const a = allSpans[i] as Span;
        const b = allSpans[j] as Span;
        expect(a.end <= b.start || b.end <= a.start, `${a.id}@${a.start} and ${b.id}@${b.start} overlap`).toBe(true);
      }
    }
  });

  it("AC-3: gives no span for the near-miss texts", async () => {
    const { spans } = await load();
    const nearMisses: Array<[string, string]> = [
      ["an env reference", `{"env": {"GITHUB_TOKEN": "\${GITHUB_TOKEN}"}}\n`],
      ["a short sk- id", "id: sk-abc123\n"],
      ["an sk- run inside a longer task- identifier", `id: mytask-${cut(44, 18)}\n`],
      ["a prefix preceded by a letter", `x${PARTS.S01}\n`],
      ["a prefix preceded by a digit", `1${PARTS.S01}\n`],
      ["a prefix preceded by _", `_${PARTS.S01}\n`],
      ["a prefix preceded by -", `-${PARTS.S01}\n`],
      ["an AWS access key id ending in EXAMPLE", `aws ${"AK" + "IA" + "IOSFODNN7" + "EXAMPLE"} end\n`],
      ["an AIza run followed by one more key character", `key ${PARTS.S04}x end\n`],
      ["a public-key BEGIN line", `-----BEGIN PUBLIC KEY-----\n${KEY_BODY}\n-----END PUBLIC KEY-----\n`],
      ["a Postgres URL on localhost", `url: postgres${COLON_SLASHES}postgres:postgres@localhost:5432/app\n`],
      ["a URL on example.com with a literal password", `url: https${COLON_SLASHES}deploy:Hunter2pass@example.com/x\n`],
      ["an env reference as a query value", `url: https${COLON_SLASHES}api.internal.io/x?token=\${T}\n`],
      ["a query value of 7 characters", `url: https${COLON_SLASHES}api.internal.io/x?token=abc1234\n`],
      ["an author key with a long high-entropy value", `{"author": "${cut(28, 19)}"}\n`],
      ["a URL value under token_url", `{"token_url": "https${COLON_SLASHES}auth.internal.io/oauth/${cut(20, 20)}"}\n`],
      ["a path value under secret_file", `{"secret_file": "/run/secrets/${cut(24, 21)}"}\n`],
      ["a 24-character low-entropy value under password", '{"pass' + 'word": "aaaaaaaaaaaabbbbbbbbbbbb"}\n'],
      ["a value with a space under api_key", `{"api_key": "${cut(12, 22)} ${cut(12, 23)}"}\n`],
    ];
    for (const [label, text] of nearMisses) expect(spans(text), label).toEqual([]);
  });

  it("AC-4: a private-key block runs from BEGIN to the end of END (or of the text), and redaction keeps what follows", async () => {
    const { spans, redactSecrets } = await load();
    for (const form of FORMS) {
      const label = form === "" ? "bare form" : form.trim();
      const begin = keyLine("BEGIN", form);
      const end = keyLine("END", form);

      const before = "config line\n";
      const block = `${begin}\n${KEY_BODY}\n${end}`;
      const after = "\nmore text after the key\n";
      const text = before + block + after;
      expect(spans(text), `${label}: with END`).toEqual([
        { id: "S08", start: before.length, end: before.length + block.length },
      ]);
      expect(redactSecrets(text), `${label}: redacted with END`).toBe(`${before}[redacted:S08]${after}`);

      const open = `${before}${begin}\n${KEY_BODY}\nno end line here\n`;
      expect(spans(open), `${label}: without END`).toEqual([{ id: "S08", start: before.length, end: open.length }]);
      expect(redactSecrets(open), `${label}: redacted without END`).toBe(`${before}[redacted:S08]`);
    }
  });
});
