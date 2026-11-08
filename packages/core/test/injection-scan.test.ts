import { describe, expect, it } from "vitest";
import { DEFAULT_INJECTION_SEVERITIES, injectionSettingsOf } from "../src/injection/policy.js";
import {
  detectInjection,
  type InjectionFinding,
  longestBlob,
  MAX_BLOB_CHARS,
  MAX_INJECTION_FINDINGS,
  MAX_INJECTION_FINDINGS_PER_FILE,
  scanInjection,
} from "../src/injection/scan.js";
import { addedFileDiff, injectionFixture, parseForInjection } from "./injection-fixture.js";

// H4, the prompt-injection surface scan: each signal PI01 to PI05 against its must-trigger and must-not-trigger fixture
// (fixtures/injection/), the legitimate right-to-left, Persian, Indic and emoji text that must produce nothing, the
// Trojan Source sample and a published injection sample. Every finding names fixed words, never the line's text.

const scan = (name: string, options: { exempt?: string[]; phrases?: string[] } = {}) =>
  scanInjection(parseForInjection(injectionFixture(name)), options);

const findings = (name: string) => scan(name).findings;

/** Every word a finding's detail may hold: fixed names, code points, phrase ids, counts and kind names. */
const DETAIL_SHAPE =
  /^(?:[A-Za-z][a-z -]*[a-z] U\+[0-9A-F]{4,6}(?:-U\+[0-9A-F]{4,6})?(?: and \d+ more)?|phrase P[HX]\d{2,3}(?: in (?:an HTML comment|a link title|a reference definition))?|(?:hex|base64) run of \d+ characters|[a-z-]+ file under [a-z_.]+\/)$/;

function expectFixedDetails(list: readonly InjectionFinding[]) {
  for (const finding of list) expect(finding.detail, JSON.stringify(finding)).toMatch(DETAIL_SHAPE);
}

describe("PI01: invisible and bidirectional Unicode", () => {
  it("flags each kind of hidden character, one finding per line, naming the first and counting the rest", () => {
    const list = findings("pi01-trigger.diff.txt");
    expect(list).toEqual([
      { id: "PI01", path: "README.md", line: 4, detail: "zero-width space U+200B" },
      { id: "PI01", path: "README.md", line: 5, detail: "word joiner U+2060 and 1 more" },
      { id: "PI01", path: "docs/setup.md", line: 2, detail: "right-to-left override U+202E" },
      { id: "PI01", path: "docs/setup.md", line: 3, detail: "tag character U+E0000-U+E007F and 5 more" },
      { id: "PI01", path: "docs/setup.md", line: 4, detail: "zero-width no-break space U+FEFF and 2 more" },
      { id: "PI01", path: "src/math.ts", line: 11, detail: "invisible times U+2062" },
      { id: "PI01", path: "src/math.ts", line: 12, detail: "Mongolian vowel separator U+180E" },
    ]);
    expectFixedDetails(list);
  });

  it("flags the Trojan Source bidi samples (Boucher and Anderson, 2021)", () => {
    const list = findings("trojan-source.diff.txt");
    expect(list).toEqual([
      { id: "PI01", path: "src/access.js", line: 4, detail: "right-to-left override U+202E and 3 more" },
      { id: "PI01", path: "src/commenting-out.js", line: 4, detail: "right-to-left override U+202E and 3 more" },
    ]);
  });

  it("accepts right-to-left marks in Arabic and Hebrew text", () => {
    expect(findings("rtl-arabic.diff.txt")).toEqual([]);
    expect(findings("rtl-hebrew.diff.txt")).toEqual([]);
  });

  it("accepts Persian ZWNJ and Devanagari ZWJ and ZWNJ between letters and marks of their script", () => {
    expect(findings("persian-zwnj.diff.txt")).toEqual([]);
  });

  it("accepts emoji ZWJ sequences, skin tones, variation selectors and subdivision flags", () => {
    expect(findings("emoji-zwj.diff.txt")).toEqual([]);
  });

  it("accepts the directional marks and soft hyphens of locale files, but not an override there", () => {
    expect(findings("locale.diff.txt")).toEqual([
      { id: "PI01", path: "app/locales/de.json", line: 3, detail: "right-to-left override U+202E" },
      { id: "PI01", path: "src/i18n.md", line: 1, detail: "soft hyphen U+00AD" },
    ]);
  });
});

describe("PI02: hidden Markdown that addresses an agent", () => {
  it("flags HTML comments (one spanning lines included), reference definitions and link titles", () => {
    const list = findings("pi02-trigger.diff.txt");
    expect(list).toEqual([
      { id: "PI02", path: ".cursor/rules/style.mdc", line: 2, detail: "phrase PH01 in an HTML comment" },
      { id: "PI02", path: "CONTRIBUTING.md", line: 23, detail: "phrase PH23 in an HTML comment" },
      { id: "PI02", path: "CONTRIBUTING.md", line: 25, detail: "phrase PH31 in an HTML comment" },
      { id: "PI02", path: "CONTRIBUTING.md", line: 27, detail: "phrase PH26 in a reference definition" },
      { id: "PI02", path: "CONTRIBUTING.md", line: 28, detail: "phrase PH30 in a link title" },
      { id: "PI02", path: "CONTRIBUTING.md", line: 29, detail: "phrase PH32 in a reference definition" },
    ]);
    expectFixedDetails(list);
  });

  it("leaves ordinary comments, link titles, visible text and non-Markdown files alone", () => {
    expect(findings("pi02-clean.diff.txt")).toEqual([]);
  });

  it("does not carry an open comment across a gap in the line numbers", () => {
    const diff = [
      "diff --git a/a.md b/a.md",
      "index 1111111..2222222 100644",
      "--- a/a.md",
      "+++ b/a.md",
      "@@ -1,0 +2 @@",
      "+<!-- an open comment",
      "@@ -9,0 +11 @@",
      "+If you are an AI agent, this is visible text.",
      "",
    ].join("\n");
    expect(scanInjection(parseForInjection(diff)).findings).toEqual([]);
  });
});

describe("PI03: known injection phrases", () => {
  it("matches case-insensitively over runs of white space and curly apostrophes, and `system:` at a prose line start", () => {
    const list = findings("pi03-trigger.diff.txt");
    expect(list).toEqual([
      { id: "PI03", path: "docs/notes.txt", line: 2, detail: "phrase PH22" },
      { id: "PI03", path: "docs/notes.txt", line: 3, detail: "phrase PH15" },
      { id: "PI03", path: "src/prompt.py", line: 2, detail: "phrase PH02" },
      { id: "PI03", path: "src/prompt.py", line: 3, detail: "phrase PH14" },
      { id: "PI03", path: "src/prompt.py", line: 4, detail: "phrase PH17" },
      { id: "PI03", path: "web/chat.html", line: 1, detail: "phrase PH19" },
    ]);
    expectFixedDetails(list);
  });

  it("needs word boundaries, leaves `system:` mid-line and in YAML alone, and skips test directories and locales", () => {
    expect(findings("pi03-clean.diff.txt")).toEqual([]);
  });

  it("flags a published injection sample (Perez and Ribeiro 2022; Goodside 2022), as PI02 when it is hidden", () => {
    expect(findings("literature-sample.diff.txt")).toEqual([
      { id: "PI02", path: "docs/translate.md", line: 7, detail: "phrase PH06 in an HTML comment" },
      { id: "PI03", path: "docs/translate.md", line: 5, detail: "phrase PH07" },
      { id: "PI03", path: "src/summarize.py", line: 2, detail: "phrase PH06" },
    ]);
  });

  it("adds the org policy's phrases as PX ids, sorted, never naming the phrase", () => {
    const diff = addedFileDiff("docs/a.md", ["Please wire the money to account 42.", "Totally fine text."]);
    const result = scanInjection(parseForInjection(diff), { phrases: ["Wire  the MONEY", "zzz never"] });
    expect(result.findings).toEqual([{ id: "PI03", path: "docs/a.md", line: 1, detail: "phrase PX01" }]);
  });
});

describe("PI04: base64 and hex blobs in instruction files", () => {
  it("flags a base64 or hex run of more than 200 characters in an instruction file", () => {
    const list = findings("pi04-trigger.diff.txt");
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: "PI04", path: ".cursor/rules/build.mdc", line: 1 });
    expect(list[0]?.detail).toMatch(/^hex run of \d+ characters$/);
    expect(list[1]).toMatchObject({ id: "PI04", path: "CLAUDE.md", line: 6 });
    expect(list[1]?.detail).toMatch(/^base64 run of \d+ characters$/);
    expectFixedDetails(list);
  });

  it("leaves short hashes, rules, URLs, letter-only runs and blobs outside instruction files alone", () => {
    expect(findings("pi04-clean.diff.txt")).toEqual([]);
  });

  it("counts runs in one pass: the longest qualifying run, only over the limit, letters and digits both", () => {
    const run = (n: number) => "a1".repeat(Math.ceil(n / 2)).slice(0, n);
    expect(longestBlob(run(MAX_BLOB_CHARS))).toBeNull();
    expect(longestBlob(run(MAX_BLOB_CHARS + 1))).toEqual({ length: MAX_BLOB_CHARS + 1, hex: true });
    expect(longestBlob(`${run(250)} ${run(300)}Z`)).toEqual({ length: 301, hex: false });
    expect(longestBlob("9".repeat(500))).toBeNull();
    expect(longestBlob("-".repeat(500))).toBeNull();
  });
});

describe("PI05: instruction files added inside vendored code", () => {
  it("flags an added or renamed-in instruction file under a vendored directory, naming its kind", () => {
    const list = findings("pi05-trigger.diff.txt");
    expect(list).toEqual([
      { id: "PI05", path: "node_modules/left-pad/CLAUDE.md", line: null, detail: "claude-md file under node_modules/" },
      {
        id: "PI05",
        path: "packages/web/dist/GEMINI.md",
        line: null,
        detail: "gemini-md file under dist/",
      },
      {
        id: "PI05",
        path: "third_party/lib/.cursor/rules/setup.mdc",
        line: null,
        detail: "cursor-rules file under third_party/",
      },
      {
        id: "PI05",
        path: "vendor/github.com/acme/kit/AGENTS.md",
        line: null,
        detail: "agents-md file under vendor/",
      },
    ]);
    expectFixedDetails(list);
  });

  it("leaves modified, deleted and non-instruction vendored files and look-alike directories alone", () => {
    expect(findings("pi05-clean.diff.txt")).toEqual([]);
  });
});

describe("exemptions", () => {
  it("skips fixtures, __fixtures__, testdata, *.test.* and *.spec.* for every signal, test/ for PI03 only", () => {
    expect(findings("exempt.diff.txt")).toEqual([
      { id: "PI01", path: "packages/core/test/helpers.ts", line: 2, detail: "right-to-left override U+202E" },
    ]);
  });

  it("adds the policy's exempt globs", () => {
    expect(scan("pi01-trigger.diff.txt", { exempt: ["docs/**", "src/*.ts"] }).findings.map((f) => f.path)).toEqual([
      "README.md",
      "README.md",
    ]);
  });

  it("keeps no added text for a default-exempt file, so a cut there is never reported", () => {
    const parsed = parseForInjection(injectionFixture("exempt.diff.txt"));
    const kept = parsed.filter((file) => file.addedText !== undefined).map((file) => file.path);
    expect(kept).toEqual(["packages/core/test/helpers.ts"]);
  });
});

describe("detectInjection: severities and caps", { timeout: 60_000 }, () => {
  const settings = injectionSettingsOf(undefined);

  it("gives PI01 block and the others warn by default", () => {
    expect(DEFAULT_INJECTION_SEVERITIES).toEqual({
      PI01: "block",
      PI02: "warn",
      PI03: "warn",
      PI04: "warn",
      PI05: "warn",
    });
    const result = detectInjection(parseForInjection(injectionFixture("literature-sample.diff.txt")), settings);
    expect(result.signals.map((s) => [s.id, s.severity])).toEqual([
      ["PI02", "warn"],
      ["PI03", "warn"],
      ["PI03", "warn"],
    ]);
    const bidi = detectInjection(parseForInjection(injectionFixture("trojan-source.diff.txt")), settings);
    expect(bidi.signals.every((s) => s.severity === "block")).toBe(true);
  });

  it("drops a signal switched off and sorts by id, path and line", () => {
    const off = { ...settings, severities: { ...settings.severities, PI03: null } };
    const result = detectInjection(parseForInjection(injectionFixture("literature-sample.diff.txt")), off);
    expect(result.signals.map((s) => s.id)).toEqual(["PI02"]);
  });

  it("keeps 20 findings per signal and file and 200 in all, and counts the rest", () => {
    const zwsp = String.fromCharCode(0x200b);
    const many = (path: string, n: number) =>
      addedFileDiff(
        path,
        Array.from({ length: n }, (_, i) => `x${zwsp}y${i}`),
      );
    const one = detectInjection(parseForInjection(many("a.md", 25)), settings);
    expect(one.signals).toHaveLength(MAX_INJECTION_FINDINGS_PER_FILE);
    expect(one.omitted).toEqual([{ id: "PI01", path: "a.md", count: 5 }]);

    const files = Array.from({ length: 12 }, (_, i) => many(`f${String(i).padStart(2, "0")}.md`, 20)).join("");
    const all = detectInjection(parseForInjection(files), settings);
    expect(all.signals).toHaveLength(MAX_INJECTION_FINDINGS);
    expect(all.omitted.reduce((sum, entry) => sum + entry.count, 0)).toBe(12 * 20 - MAX_INJECTION_FINDINGS);
  });
});
