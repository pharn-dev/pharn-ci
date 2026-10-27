import { describe, expect, it } from "vitest";

// E3 item 23 (policy settings), AC-5. covers() and overlapsForbidden() are loaded inside the test body: the AC test is
// written before the build adds them, so nothing the build adds may run while this file loads.
//
// The reference below is written from the binding grammar, independently of the build: star-only Bash patterns (a
// trailing ` *` is a prefix: `P *` is `P` or `P ★`; every other `*` is any run of characters) and ANCHOR path globs
// (gitignore-style: no inner `/` means `**/rest`; a trailing `/` is dir-only, `X/**`; a trailing `**` is `**/*`; a
// plain path with a literal last segment read broad is `X` or `X/**`). Over a 3-letter alphabet every string up to
// length 6 is enumerated: the second pattern at its literal language, the first at its reading's language.

interface Rules {
  covers(a: string, f: string, reading: "p02" | "p03"): boolean;
  overlapsForbidden(allow: string, forbidden: string): boolean;
}

/** mulberry32: a small seeded generator, so a failure reproduces. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every string over `alphabet` of length 0 to `max`. */
function strings(alphabet: readonly string[], max: number): string[] {
  const out = [""];
  let level = [""];
  for (let n = 1; n <= max; n++) {
    level = level.flatMap((s) => alphabet.map((c) => s + c));
    out.push(...level);
  }
  return out;
}

/** `*` is any run of characters (possibly empty), `?` one character when `question` is set; the rest is literal. */
function glob(pattern: string, text: string, question: boolean): boolean {
  // prev[j]: pattern[0..i) matches text[0..j).
  let prev = new Array<boolean>(text.length + 1).fill(false);
  prev[0] = true;
  for (const p of pattern) {
    const next = new Array<boolean>(text.length + 1).fill(false);
    if (p === "*") {
      for (let j = 0; j <= text.length; j++) next[j] = prev[j] || (j > 0 && next[j - 1]);
    } else {
      for (let j = 1; j <= text.length; j++) next[j] = prev[j - 1] && ((question && p === "?") || p === text[j - 1]);
    }
    prev = next;
  }
  return prev[text.length];
}

// ---- Bash ----

const BASH_STRINGS = strings(["a", "b", " "], 6);

function bashMatches(spec: string, text: string): boolean {
  const alternatives = spec.endsWith(" *") ? [spec.slice(0, -2), `${spec.slice(0, -2)} *`] : [spec];
  return alternatives.some((alt) => glob(alt, text, false));
}

function bashPatterns(random: () => number, count: number): string[] {
  const out = new Set<string>(["a", "a *", "a*", "*", "* b", "a b", "ab *", "* *", "a*b", "b a *"]);
  while (out.size < count) {
    const first = ["a", "b", "*"][Math.floor(random() * 3)] as string;
    let spec = first;
    const more = Math.floor(random() * 4);
    for (let i = 0; i < more; i++) spec += ["a", "b", " ", "*"][Math.floor(random() * 4)];
    out.add(spec);
  }
  return [...out];
}

// ---- paths (ANCHOR root, as in one unit) ----

/** Valid relative paths over {a, b, /} up to length 6: non-empty segments. */
const PATH_STRINGS = strings(["a", "b", "/"], 6)
  .filter((s) => s !== "" && !s.startsWith("/") && !s.endsWith("/") && !s.includes("//"))
  .map((s) => s.split("/"));

interface PathPattern {
  segments: string[];
  /** A plain pattern (not dir-only) whose last segment holds no `*` or `?`. */
  literalEnd: boolean;
}

const collapse = (segments: string[]) => segments.filter((s, i) => !(s === "**" && segments[i - 1] === "**"));

function pathPattern(text: string): PathPattern {
  let rest = text;
  let anchored = false;
  if (rest.startsWith("/")) {
    rest = rest.slice(1);
    anchored = true;
  }
  if (!anchored && !rest.slice(0, -1).includes("/")) rest = `**/${rest}`;
  const dirOnly = rest.endsWith("/");
  if (dirOnly) rest = rest.slice(0, -1);
  let segments = collapse(rest.split("/").map((s) => (s === "**" ? s : s.replaceAll("**", "*"))));
  const last = segments[segments.length - 1] as string;
  const literalEnd = !dirOnly && !last.includes("*") && !last.includes("?");
  if (dirOnly) segments = collapse([...segments, "**"]);
  if (segments[segments.length - 1] === "**") segments = [...segments, "*"];
  return { segments, literalEnd };
}

function segmentsMatch(pattern: readonly string[], path: readonly string[]): boolean {
  // prev[j]: pattern[0..i) matches path[0..j).
  let prev = new Array<boolean>(path.length + 1).fill(false);
  prev[0] = true;
  for (const seg of pattern) {
    const next = new Array<boolean>(path.length + 1).fill(false);
    if (seg === "**") {
      for (let j = 0; j <= path.length; j++) next[j] = prev[j] || (j > 0 && next[j - 1]);
    } else {
      for (let j = 1; j <= path.length; j++) next[j] = prev[j - 1] && glob(seg, path[j - 1] as string, true);
    }
    prev = next;
  }
  return prev[path.length];
}

function pathMatches(text: string, broad: boolean, path: readonly string[]): boolean {
  const p = pathPattern(text);
  if (segmentsMatch(p.segments, path)) return true;
  return broad && p.literalEnd && segmentsMatch([...p.segments, "**", "*"], path);
}

function pathPatterns(random: () => number, count: number): string[] {
  const out = new Set<string>(["a", "a/b", "/a", "a/", "**", "a/**", "*", "a/*", "**/a", "*b", "a?", "/a/b/"]);
  const SEGMENTS = ["a", "b", "*", "?", "**", "a*", "*b"];
  while (out.size < count) {
    const n = 1 + Math.floor(random() * 3);
    let text = Array.from({ length: n }, () => SEGMENTS[Math.floor(random() * SEGMENTS.length)]).join("/");
    if (random() < 0.3) text = `/${text}`;
    if (random() < 0.2) text = `${text}/`;
    out.add(text);
  }
  return [...out];
}

// ---- the check ----

type Family = {
  label: string;
  wrap: (spec: string) => string;
  patterns: string[];
  /** The language of a pattern over the family's strings: read broad (the covering side under p02) or literal. */
  language: (spec: string, broad: boolean) => boolean[];
};

function counterexample(sub: boolean[], sup: boolean[]): number {
  for (let i = 0; i < sub.length; i++) if (sub[i] && !sup[i]) return i;
  return -1;
}

describe("covers is reflexive and sound", { timeout: 120_000 }, () => {
  it("AC-5: against brute-force enumeration in both readings and both argument orders, plus the fixed two-direction rows", async () => {
    const rules = (await import("@pharn-ci/core")) as unknown as Rules;
    expect(typeof rules.covers, "covers is exported").toBe("function");
    expect(typeof rules.overlapsForbidden, "overlapsForbidden is exported").toBe("function");

    // The fixed rows (C1): an allow entry inside a forbidden one triggers; a partial overlap neither direction can
    // prove does not, in either order.
    expect(rules.overlapsForbidden("WebFetch(domain:x.com)", "WebFetch")).toBe(true);
    expect(rules.covers("WebFetch(domain:x.com)", "WebFetch", "p02"), "the allow entry is not broader").toBe(false);
    expect(rules.covers("WebFetch", "WebFetch(domain:x.com)", "p02"), "the forbidden entry is broader").toBe(true);
    expect(rules.overlapsForbidden("Bash(rm -rf /tmp)", "Bash(rm:*)")).toBe(true);
    expect(rules.covers("Bash(rm -rf /tmp)", "Bash(rm:*)", "p02")).toBe(false);
    expect(rules.covers("Bash(rm:*)", "Bash(rm -rf /tmp)", "p02")).toBe(true);
    for (const [a, f] of [
      ["Bash(git *)", "Bash(* --force)"],
      ["Bash(* --force)", "Bash(git *)"],
    ] as const) {
      expect(rules.overlapsForbidden(a, f), `${a} vs ${f}: not flagged`).toBe(false);
      for (const reading of ["p02", "p03"] as const) expect(rules.covers(a, f, reading)).toBe(false);
    }

    const random = seeded(0x23_0705);
    const families: Family[] = [
      {
        label: "Bash",
        wrap: (spec) => `Bash(${spec})`,
        patterns: bashPatterns(random, 60),
        language: (spec) => BASH_STRINGS.map((s) => bashMatches(spec, s)),
      },
      {
        label: "Read",
        wrap: (spec) => `Read(${spec})`,
        patterns: pathPatterns(random, 60),
        language: (spec, broad) => PATH_STRINGS.map((s) => pathMatches(spec, broad, s)),
      },
    ];

    for (const family of families) {
      const literal = new Map(family.patterns.map((p) => [p, family.language(p, false)]));
      const broad = new Map(family.patterns.map((p) => [p, family.language(p, true)]));
      const sample = family.label === "Bash" ? BASH_STRINGS : PATH_STRINGS.map((s) => s.join("/"));
      let claims = 0;
      for (const x of family.patterns) {
        for (const reading of ["p02", "p03"] as const) {
          expect(
            rules.covers(family.wrap(x), family.wrap(x), reading),
            `${family.wrap(x)} covers itself (${reading})`,
          ).toBe(true);
        }
        for (const y of family.patterns) {
          const a = family.wrap(x);
          const f = family.wrap(y);
          // covers(a, f, p02): a read broad, f literal; covers(a, f, p03): a read narrow (literal), f literal.
          for (const reading of ["p02", "p03"] as const) {
            if (!rules.covers(a, f, reading)) continue;
            claims += 1;
            const sup = (reading === "p02" ? broad : literal).get(x) as boolean[];
            const at = counterexample(literal.get(y) as boolean[], sup);
            expect(at, `covers(${a}, ${f}, ${reading}) but ${JSON.stringify(sample[at])} is in f and not in a`).toBe(
              -1,
            );
          }
          // C1: overlapsForbidden(allow, forbidden) needs one provable direction.
          if (rules.overlapsForbidden(a, f)) {
            const forward = counterexample(literal.get(y) as boolean[], broad.get(x) as boolean[]) === -1;
            const reverse = counterexample(literal.get(x) as boolean[], broad.get(y) as boolean[]) === -1;
            expect(forward || reverse, `overlapsForbidden(${a}, ${f}) with neither direction true`).toBe(true);
          }
        }
      }
      expect(claims, `${family.label}: covers claimed some non-trivial inclusions`).toBeGreaterThan(
        family.patterns.length * 2,
      );
    }
  });
});
