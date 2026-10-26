import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Reads test files as text only; nothing the build adds is loaded. The patterns are built from parts so this file
// does not match itself, and it is left out of the scan anyway. A skip, runIf or branch conditioned on python3 is one
// whose condition names python (a HAS_PYTHON-style flag, PYTHON.ok, …); a guard that throws is not a branch.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SELF = "packages/core/test/ac-pyparity2-no-python-skip.test.ts";
const CLI = "packages/cli/test/ac-ti0205-cli.test.ts";
const PY = ["P", "Y", "T", "H", "O", "N"].join("");

/** Every `packages/<pkg>/test/**\/*.test.ts` file, repo-relative. */
function testFiles(): string[] {
  const out: string[] = [];
  for (const pkg of readdirSync(join(ROOT, "packages"), { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const dir = join(ROOT, "packages", pkg.name, "test");
    let names: string[];
    try {
      names = readdirSync(dir, { recursive: true, encoding: "utf8" });
    } catch {
      continue;
    }
    for (const name of names) {
      const rel = name.split("\\").join("/");
      if (rel.endsWith(".test.ts")) out.push(`packages/${pkg.name}/test/${rel}`);
    }
  }
  return out.sort();
}

/** The text of the parenthesized argument list whose `(` is at `open`, or the rest of the text when unclosed. */
function argsAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

/** What a file holds that conditions a test on python3: each offending snippet. */
function pythonConditions(text: string): string[] {
  const found: string[] = [];
  const flag = new RegExp(`\\b\\w*${PY}\\w*(?:\\.\\w+)*`, "i");

  // A skip or runIf whose condition names python: it.skipIf(…), describe.runIf(…), test.skipIf(…)(…), ctx.skip(…).
  const skips =
    /\b(?:(?:it|test|describe|suite|bench)(?:\.(?:concurrent|sequential|each|only))*\.(skipIf|runIf)|(?:ctx|context|t)\.(skip))\s*\(/g;
  for (const m of text.matchAll(skips)) {
    const args = argsAt(text, (m.index ?? 0) + m[0].length - 1).slice(0, 200);
    if (flag.test(args) && !/^\s*["'`]/.test(args)) found.push(`${m[1] ?? m[2]}(${args.slice(0, 60)})`);
  }
  // A conditional expression on a python flag: `HAS_X ? a : b`.
  for (const m of text.matchAll(new RegExp(`\\b\\w*${PY}\\w*(?:\\.\\w+)*\\s*\\?(?![.?])`, "gi"))) found.push(m[0]);
  // An if on a python flag whose block does not start by throwing: `if (HAS_X) {` / `if (!X.ok) return;`.
  for (const m of text.matchAll(
    new RegExp(`\\bif\\s*\\(\\s*!?\\s*\\w*${PY}\\w*(?:\\.\\w+)*\\s*\\)\\s*\\{?\\s*`, "gi"),
  )) {
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 5);
    if (after !== "throw") found.push(m[0].trim());
  }
  return found;
}

/** The `it(` call whose title holds `needle`: its title literal and its body text up to the matching `)`. */
function itCall(text: string, needle: string): { title: string; body: string } {
  for (const m of text.matchAll(/\bit\s*\(/g)) {
    const args = argsAt(text, (m.index ?? 0) + m[0].length - 1);
    const quote = args.trimStart()[0];
    if (quote !== "`" && quote !== '"' && quote !== "'") continue;
    const start = args.indexOf(quote);
    let end = start + 1;
    let depth = 0;
    for (; end < args.length; end++) {
      const c = args[end];
      if (c === "\\") end++;
      else if (quote === "`" && c === "$" && args[end + 1] === "{") {
        depth++;
        end++;
      } else if (quote === "`" && c === "}" && depth > 0) depth--;
      else if (c === quote && depth === 0) break;
    }
    const title = args.slice(start, end + 1);
    if (title.includes(needle)) return { title, body: args.slice(end + 1) };
  }
  throw new Error(`no it( whose title holds ${needle}`);
}

describe("no test is skipped or branched on whether python3 is present", () => {
  it('AC-12: no test file under packages/*/test holds a skip, runIf or assertion branch conditioned on python3, and the CLI --test-integrity block test has one fixed title and always asserts the Python TI02 and languages ["py", "ts"]', () => {
    const files = testFiles().filter((f) => f !== SELF);
    expect(files.length, "the test files are found").toBeGreaterThan(100);
    expect(files).toContain(CLI);
    expect(files).toContain("packages/node-io/test/ac-ti0205-python.test.ts");

    const offending = files
      .map((f) => [f, pythonConditions(readFileSync(join(ROOT, f), "utf8"))] as const)
      .filter(([, found]) => found.length > 0);
    expect(offending, "no python3-conditioned skip, runIf, title or branch").toEqual([]);

    const cli = readFileSync(join(ROOT, CLI), "utf8");
    const { title, body } = itCall(cli, "--test-integrity block");
    expect(title, "one fixed title, with no conditional part").not.toMatch(/\$\{[^}]*\?/);
    expect(title, 'the title names languages ["py", "ts"]').toContain('languages ["py", "ts"]');
    expect(body, "no branch in the test body").not.toMatch(/\bif\s*\(|\belse\b/);
    expect(body, "asserts a TI02 on the Python file").toMatch(/"TI02"[^\n]*PY_PATH|PY_PATH[^\n]*"TI02"/);
    expect(body, 'asserts languages ["py", "ts"]').toMatch(/testIntegrity\.languages\)\.toEqual\(\["py", "ts"\]\)/);
  });
});
