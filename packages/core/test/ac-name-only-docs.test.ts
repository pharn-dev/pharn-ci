import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The docs are read inside the test body, through git, as this increment's own change: from the base commit 8302706
// to the working tree while this file is not committed, then from the parent of the commit that added this file to
// that commit, so a later docs change on main does not move what this test compares. The AC test is written before the
// docs are updated. Prose is checked loosely (whitespace folded, case ignored) for what it must name: the TI01 same-stem
// item names the body evidence, that the stem-linked file has no name check, and that the case blocks when no sources
// are given; the TI02 leaf-name item says the same-name test must hold the body; the "Order of the rules" line names
// the body evidence for the cross-file leaf name; the README TI01 row, TI02 row and removed-test sentence, and the
// PRECISION §2 TI01 bullet, say a same-name file or test must hold the body. Every other README line, the other
// sentences of the removed-test paragraph, the CHANGELOG's earlier Unreleased lines and docs/THREAT-MODEL.md stay as
// they were.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "8302706940805000e8a206c6668ec3340b8d88e9";
const SELF = "packages/core/test/ac-name-only-docs.test.ts";

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const fold = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** From the base commit to the working tree while this file is not committed, else the commit that added it. */
function changeRange(): { from: string; to: string | null } {
  const added = git("log", "--diff-filter=A", "--format=%H", "-1", "--", SELF).trim();
  return added === "" ? { from: BASE, to: null } : { from: `${added}^`, to: added };
}

/** The text from a heading line that starts with `heading` to the next heading of the same or a higher level. */
function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith(heading));
  expect(at, `the section ${heading}`).toBeGreaterThan(-1);
  const level = (/^#+/.exec(heading)?.[0] ?? "#").length;
  const end = lines.findIndex((line, i) => i > at && /^#+ /.test(line) && (/^#+/.exec(line)?.[0].length ?? 9) <= level);
  return lines.slice(at, end === -1 ? undefined : end).join("\n");
}

/** The top-level `- ` items of a text, each with its indented continuation lines joined. */
function items(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) out.push(line);
    else if (line.startsWith("  ") && out.length > 0) out[out.length - 1] += ` ${line.trim()}`;
    else if (/^\S/.test(line) && out.length > 0 && !line.startsWith("- ")) out.push("");
  }
  return out.filter((item) => item !== "");
}

/** The `- **What TI01 misses.**` item, split into its numbered parts `(1)`, `(2)`, …, folded. */
function ti01Parts(limits: string): string[] {
  const item = items(limits).find((i) => i.startsWith("- **What TI01 misses.**"));
  expect(item, "the What TI01 misses item").toBeDefined();
  return fold(item as string)
    .split(/ (?=\(\d+\) )/)
    .slice(1);
}

/** The sentences of a folded paragraph: split after a period that a capital or a backtick follows. */
const sentences = (paragraph: string) =>
  paragraph
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=\.) (?=[A-Z`])/);

/** The blank-line-delimited paragraph (as lines) that holds `needle`, with its first and last line index. */
function paragraphOf(lines: string[], needle: RegExp): { start: number; end: number } {
  const at = lines.findIndex((line, i) => needle.test(`${lines[i - 1] ?? ""} ${line}`));
  expect(at, `a README paragraph matching ${needle}`).toBeGreaterThan(-1);
  let start = at;
  while (start > 0 && (lines[start - 1] ?? "").trim() !== "") start--;
  let end = at;
  while (end < lines.length - 1 && (lines[end + 1] ?? "").trim() !== "") end++;
  return { start, end };
}

const REMOVED = /counts? as removed/i;
const TI01_ROW = "| `TEST_INTEGRITY_TI01`";
const TI02_ROW = "| `TEST_INTEGRITY_TI02`";
/** A same-name test (or file) must hold the body: "holds/keeps/contains … body". */
const HOLDS_BODY = /\b(holds?|keeps?|contains?)\b[^|.;]{0,80}\bbod(y|ies)\b/;
const OTHER_TOUCHED = /\b(another|other)\b[^|.;]{0,40}\btouched\b/;

describe("name-only moves: the docs", () => {
  it("AC-10: docs/LIMITS.md names the TI01 same-stem body evidence, the TI02 leaf-name item and the order of the rules with TI17 still last, the CHANGELOG Unreleased section has one line for this change and keeps its earlier lines, the README TI01 row, TI02 row and removed-test sentence ask for the body and every other README line is unchanged, the PRECISION §2 TI01 bullet asks for every body, and docs/THREAT-MODEL.md is byte-identical to the base commit", () => {
    const range = changeRange();
    const before = (path: string) => git("show", `${range.from}:${path}`);
    const after = (path: string) =>
      range.to === null ? readFileSync(`${ROOT}${path}`, "utf8") : git("show", `${range.to}:${path}`);
    const limits = after("docs/LIMITS.md");

    // What TI01 misses: an item for the same-stem replacement.
    const stem = ti01Parts(limits).filter((part) => /test file (of|with) the same (name|stem)/.test(part));
    expect(stem.length, "a What TI01 misses item for a test file replaced by one of the same name").toBeGreaterThan(0);
    const item = stem.join(" ");
    expect(item, "it names the body evidence").toMatch(/\bbod(y|ies)\b/);
    expect(item, "it says the stem-linked file has no name check").toMatch(
      /(\bno\b|\bnot\b|\bwithout\b|\bnever\b|\bskip\w*|\blift\w*|\bwaive\w*|\bdrop\w*)[^.;]{0,80}\bnames?\b|\bnames?\b[^.;]{0,80}(\bno\b|\bnot\b|\bskipped\b)/,
    );
    expect(item, "and that it blocks").toMatch(/\bblock/);
    expect(item, "when no sources are given").toMatch(
      /(\bno\b|\bwithout\b|\bmissing\b)[^.;]{0,40}\bsources\b|\bsources\b[^.;]{0,40}(\bmissing\b|\bnot given\b|\babsent\b)/,
    );

    // What TI02 misses: the item about a deleted test matched by a leaf name in another touched file.
    const ti02 = items(section(limits, "### What TI02 misses")).map(fold);
    const leafItems = ti02.filter((i) => /^- \*\*[^*]*leaf name[^*]*\*\*/.test(i));
    expect(leafItems, "one TI02 item titled with the leaf name").toHaveLength(1);
    const leafItem = leafItems[0] as string;
    expect(leafItem, "it keeps the words leaf name").toContain("leaf name");
    expect(leafItem, "and touched").toContain("touched");
    expect(leafItem, "it says the same-name test must hold the body").toMatch(
      /4\/5|body evidence|\bholds?\b[^.;]{0,60}\b(body|code)\b/,
    );

    // The order of the rules names the body evidence for the cross-file leaf name.
    const order = ti02.find((i) => i.startsWith("- **order of the rules.**"));
    expect(order, "the Order of the rules item").toBeDefined();
    expect(order, "it names the body evidence for the cross-file leaf name").toMatch(
      /leaf name((?!\. )[^;]){0,120}?(body evidence|4\/5|\bholds?\b|jaccard|contain)/,
    );

    // `### TI17 proposal` is still the last `###` subsection of its section.
    const notCaught = section(limits, "## What test integrity does not catch").split("\n");
    const subsections = notCaught.filter((line) => line.startsWith("### "));
    expect(subsections.at(-1) ?? "", "### TI17 proposal is the last ### subsection").toMatch(/^### TI17 proposal/);

    // The CHANGELOG Unreleased section: one line for this change, and every line it held at the base.
    const unreleasedBefore = items(section(before("CHANGELOG.md"), "## [Unreleased]"));
    const unreleased = items(section(after("CHANGELOG.md"), "## [Unreleased]"));
    for (const line of unreleasedBefore) {
      expect(unreleased, `the Unreleased line "${line.slice(0, 60)}…" is kept`).toContain(line);
    }
    const added = unreleased.filter((i) => !unreleasedBefore.includes(i));
    const mine = added.filter(
      (i) => i.includes("TI01") && i.includes("TI02") && /same[- ](name|stem)/i.test(i) && /\bbod(y|ies)\b/i.test(i),
    );
    expect(mine, "one Unreleased line names TI01, TI02, the same-name file and the body").toHaveLength(1);

    // README: the TI01 row, the TI02 row and the removed-test sentence change; nothing else does.
    const readmeBefore = before("README.md").split("\n");
    const readme = after("README.md").split("\n");
    const ti01Row = readme.find((line) => line.startsWith(TI01_ROW));
    const ti02Row = readme.find((line) => line.startsWith(TI02_ROW));
    expect(ti01Row, "the README TEST_INTEGRITY_TI01 row").toBeDefined();
    expect(ti02Row, "the README TEST_INTEGRITY_TI02 row").toBeDefined();
    const ti01Folded = fold(ti01Row as string);
    expect(ti01Folded, "the TI01 row: a migration to a same-name file must hold every deleted test's body").toMatch(
      /same name[^|]{0,200}\bevery\b[^|]{0,120}\bbod(y|ies)\b/,
    );
    const ti02Folded = fold(ti02Row as string);
    expect(ti02Folded, "the TI02 row names a same-name test").toContain("same name");
    expect(ti02Folded, "in another touched file").toMatch(OTHER_TOUCHED);
    expect(ti02Folded, "that must hold the removed test's body").toMatch(HOLDS_BODY);

    const paraBefore = paragraphOf(readmeBefore, REMOVED);
    const para = paragraphOf(readme, REMOVED);
    const was = sentences(readmeBefore.slice(paraBefore.start, paraBefore.end + 1).join(" "));
    const now = sentences(readme.slice(para.start, para.end + 1).join(" "));
    const wasAt = was.findIndex((s) => REMOVED.test(s));
    const nowAt = now.findIndex((s) => REMOVED.test(s));
    expect(nowAt, "the removed-test sentence is still in its paragraph").toBeGreaterThan(-1);
    const tail = was.length - wasAt - 1;
    expect(now.slice(0, nowAt), "the paragraph's sentences before it are unchanged").toEqual(was.slice(0, wasAt));
    expect(now.slice(now.length - tail), "the paragraph's sentences after it are unchanged").toEqual(
      was.slice(wasAt + 1),
    );
    const edited = fold(now.slice(nowAt, now.length - tail).join(" "));
    expect(edited, "the removed-test sentence names a same-name test").toContain("same name");
    expect(edited, "in another touched file").toMatch(OTHER_TOUCHED);
    expect(edited, "that must hold the removed test's body").toMatch(HOLDS_BODY);

    const others = (lines: string[], p: { start: number; end: number }) =>
      lines
        .map((line, i) => (i >= p.start && i <= p.end ? "<removed-test paragraph>" : line))
        .filter((line, i, all) => line !== "<removed-test paragraph>" || all[i - 1] !== line)
        .filter((line) => !line.startsWith(TI01_ROW) && !line.startsWith(TI02_ROW));
    expect(others(readme, para), "every other README line is unchanged from the base commit").toEqual(
      others(readmeBefore, paraBefore),
    );

    // docs/PRECISION.md §2: the TI01 bullet of "What the early dry run changed" asks for every deleted test's body.
    const dryRun = items(section(after("docs/PRECISION.md"), "### What the early dry run changed"));
    const ti01Bullet = dryRun.find((i) => i.startsWith("- **TI01**"));
    expect(ti01Bullet, "the §2 TI01 bullet").toBeDefined();
    expect(
      sentences(ti01Bullet as string)
        .map(fold)
        .filter((s) => s.includes("same name") && /\b(only|unless)\b/.test(s) && /\bevery\b/.test(s))
        .filter((s) => /\bbod(y|ies)\b/.test(s)).length,
      "a sentence: a same-name test file avoids the block only when it holds every deleted test's body",
    ).toBeGreaterThan(0);

    // docs/THREAT-MODEL.md is byte-identical to the base commit.
    expect(after("docs/THREAT-MODEL.md"), "docs/THREAT-MODEL.md as at the base commit").toBe(
      before("docs/THREAT-MODEL.md"),
    );
  });
});
