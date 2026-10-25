import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// baserate-diff-path-check AC-3: read the source text of scripts/agent-pr-baserate.mjs and check that diffPath returns
// the built /repos/…/pulls/… path only behind an anchored, wildcard-free regex literal's .test(path), and that the
// github( call requesting the diff is passed a variable assigned from diffPath(, not a template literal.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/agent-pr-baserate.mjs");

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Index just past the string or template literal starting at `start` (whose char is a quote or backtick). */
const skipString = (src: string, start: number): number => {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return i;
};

/** The text between the bracket at `open` and its matching closer, exclusive; strings are skipped. */
const balanced = (src: string, open: number): string | undefined => {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  let i = open;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(src, i);
      continue;
    }
    if (pairs[ch] !== undefined) stack.push(pairs[ch] as string);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return src.slice(open + 1, i);
    }
    i++;
  }
  return undefined;
};

/** Top-level comma-separated arguments of a call's argument text. */
const splitArgs = (text: string): string[] => {
  const args: string[] = [];
  let depth = 0;
  let from = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(text, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      args.push(text.slice(from, i).trim());
      from = i + 1;
    }
    i++;
  }
  const last = text.slice(from).trim();
  if (last !== "") args.push(last);
  return args;
};

/** The body of `function diffPath(` (or a `const diffPath = (…) =>` arrow), or undefined when it is not defined. */
const diffPathBody = (src: string): string | undefined => {
  const decl = /\bfunction\s+diffPath\s*\(|\b(?:const|let|var)\s+diffPath\s*=\s*(?:function\b[^(]*)?\(/.exec(src);
  if (decl === null) return undefined;
  const paramsOpen = decl.index + decl[0].length - 1;
  const params = balanced(src, paramsOpen);
  if (params === undefined) return undefined;
  let i = paramsOpen + params.length + 2;
  const arrow = /^\s*=>\s*/.exec(src.slice(i));
  if (arrow !== null) i += arrow[0].length;
  while (/\s/.test(src[i] ?? "")) i++;
  if (src[i] === "{") return balanced(src, i);
  const end = src.indexOf(";", i);
  return src.slice(i, end === -1 ? undefined : end);
};

type RegexTest = { literal: string; pattern: string; arg: string };

/** Every `/…/flags.test(<identifier>)` in `text`, with the literal's pattern source. */
const regexTests = (text: string): RegexTest[] => {
  const found: RegexTest[] = [];
  for (let start = text.indexOf("/"); start !== -1; start = text.indexOf("/", start + 1)) {
    let i = start + 1;
    let inClass = false;
    let closed = -1;
    while (i < text.length && text[i] !== "\n") {
      const ch = text[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (inClass) {
        if (ch === "]") inClass = false;
      } else if (ch === "[") inClass = true;
      else if (ch === "/") {
        closed = i;
        break;
      }
      i++;
    }
    if (closed === -1 || closed === start + 1) continue;
    const after = /^([a-z]*)\s*\.test\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(text.slice(closed + 1));
    if (after === null) continue;
    found.push({
      literal: text.slice(start, closed + 1 + (after[1] as string).length),
      pattern: text.slice(start + 1, closed),
      arg: after[2] as string,
    });
  }
  return found;
};

/** Why a regex pattern source breaks AC-3's anchoring and no-wildcard rules, or [] when it meets them. */
const patternProblems = (pattern: string): string[] => {
  const problems: string[] = [];
  if (!pattern.startsWith("^")) problems.push("not anchored with ^");
  let i = 0;
  let inClass = false;
  let lastToken = "";
  while (i < pattern.length) {
    const ch = pattern[i] as string;
    if (ch === "\\") {
      const next = pattern[i + 1] ?? "";
      if (next === "S" || next === "W" || next === "D") problems.push(`contains \\${next}`);
      lastToken = `\\${next}`;
      i += 2;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
    } else if (ch === "[") {
      inClass = true;
      if (pattern[i + 1] === "^") problems.push("contains [^");
    } else if (ch === ".") problems.push("contains an unescaped . outside a character class");
    lastToken = ch;
    i++;
  }
  if (lastToken !== "$") problems.push("not anchored with $");
  return problems;
};

/** Whether `body` returns `p` only when `literal.test(p)` is true. */
const returnsOnlyWhenTested = (body: string, literal: string, p: string): boolean => {
  const lit = escapeRe(literal);
  const id = escapeRe(p);
  const returnsP = [...body.matchAll(new RegExp(`\\breturn\\s+${id}\\b(?!\\s*[.([])`, "g"))];
  const guarded = new RegExp(
    `\\bif\\s*\\(\\s*${lit}\\s*\\.test\\(\\s*${id}\\s*\\)\\s*\\)\\s*\\{?\\s*return\\s+${id}\\b`,
  );
  if (guarded.test(body)) return returnsP.length === 1;
  const ternary = new RegExp(`${lit}\\s*\\.test\\(\\s*${id}\\s*\\)\\s*\\?\\s*${id}\\s*:`);
  if (ternary.test(body)) return returnsP.length === 0;
  const negated = new RegExp(
    `\\bif\\s*\\(\\s*!\\s*${lit}\\s*\\.test\\(\\s*${id}\\s*\\)\\s*\\)\\s*\\{?\\s*return\\s+(?:null|undefined)\\b`,
  ).exec(body);
  if (negated !== null) {
    return returnsP.length === 1 && (returnsP[0]?.index ?? -1) > negated.index;
  }
  return false;
};

/** The argument lists of every github( call in `src` (not its definition). */
const githubCalls = (src: string): string[][] => {
  const calls: string[][] = [];
  for (const m of src.matchAll(/(?<![\w$.])github\s*\(/g)) {
    if (/\bfunction\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
    const open = m.index + m[0].length - 1;
    const inner = balanced(src, open);
    if (inner !== undefined) calls.push(splitArgs(inner));
  }
  return calls;
};

describe("agent-pr-baserate diffPath source", () => {
  it("AC-3: diffPath guards the /repos/…/pulls/… path with an anchored, wildcard-free regex and the diff request uses it", () => {
    const source = readFileSync(SCRIPT, "utf8");

    const body = diffPathBody(source);
    expect(body, "scripts/agent-pr-baserate.mjs defines a function diffPath").toBeDefined();
    const fn = body ?? "";

    const tests = regexTests(fn);
    expect(tests.length, "diffPath calls <regex literal>.test(<path>)").toBeGreaterThan(0);

    const guards = tests.filter((t) => {
      const built = new RegExp(
        `\\b(?:const|let|var)\\s+${escapeRe(t.arg)}\\s*=\\s*\`/repos/\\$\\{[^\`]*\\}/pulls/\\$\\{[^\`]*\\}\``,
      );
      return built.test(fn) && returnsOnlyWhenTested(fn, t.literal, t.arg);
    });
    expect(
      guards.map((t) => t.literal),
      "diffPath returns the built /repos/…/pulls/… path only when <regex>.test(<path>) is true",
    ).not.toEqual([]);
    for (const guard of guards) {
      expect(patternProblems(guard.pattern), `regex ${guard.literal}`).toEqual([]);
    }

    const diffCalls = githubCalls(source).filter((args) =>
      args.some((arg) => arg.includes("application/vnd.github.diff")),
    );
    expect(diffCalls.length, "a github( call requests application/vnd.github.diff").toBeGreaterThan(0);
    for (const args of diffCalls) {
      expect(
        args.filter((arg) => arg.startsWith("`")),
        "the diff request is not passed a template literal",
      ).toEqual([]);
      const fromDiffPath = args.filter(
        (arg) =>
          /^[A-Za-z_$][\w$]*$/.test(arg) &&
          new RegExp(`\\b${escapeRe(arg)}\\s*=\\s*(?:await\\s+)?diffPath\\s*\\(`).test(source),
      );
      expect(fromDiffPath, "the diff request is passed a variable assigned from diffPath(").not.toEqual([]);
    }
  });
});
