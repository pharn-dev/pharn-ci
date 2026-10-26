import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Skylos nine, part 2: docs/LIMITS.md, section "What test integrity does not catch", keeps the vitest 7 of 9 sentence
// and its seven caught and two missed items, gains a pytest 8 of 9 sentence linking PRECISION.md, and points the
// always-true-matcher item at the TI17 proposal. The section is compared with its copy at the commit this increment
// starts from, read with git show. The document is read inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Current main before this increment: the base for the "unchanged" checks. */
const BASE = "f1b252eb1183caff8699301c992bb8e4c81454a7";
const TITLE = "What test integrity does not catch";

const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const readBase = (path: string) => execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT, encoding: "utf8" });
const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const ITEM = /^\s*(?:[-*]|\d+\.)\s+/;
const CAUGHT = /^- `([a-z-]+)` — caught by (TI\d\d)/;
const MISSED = /^- `([a-z-]+)` — missed; planned: (TI\d\d)/;

/** The lines of the `## …What test integrity does not catch` section, without its heading. */
function sectionOf(text: string): string[] {
  const all = lines(text);
  const starts = all.flatMap((line, index) => (line.startsWith("## ") && line.includes(TITLE) ? [index] : []));
  expect(starts, `one "## …${TITLE}" heading`).toHaveLength(1);
  const rest = all.slice((starts[0] as number) + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

/** The section's list items, each joined with its continuation lines and whitespace-normalized. */
function itemsOf(section: string[]): string[] {
  const items: string[] = [];
  let current: string[] | null = null;
  for (const line of section) {
    if (ITEM.test(line)) {
      if (current) items.push(normalize(current.join(" ")));
      current = [`- ${line.replace(ITEM, "")}`];
    } else if (line.trim() === "" || line.startsWith("#")) {
      if (current) items.push(normalize(current.join(" ")));
      current = null;
    } else if (current) {
      current.push(line);
    }
  }
  if (current) items.push(normalize(current.join(" ")));
  return items;
}

/** The section's paragraphs that are not list items or headings, each whitespace-normalized. */
function paragraphsOf(section: string[]): string[] {
  const out: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) out.push(normalize(current.join(" ")));
    current = [];
  };
  let inItem = false;
  for (const line of section) {
    if (line.trim() === "" || line.startsWith("#")) {
      flush();
      inItem = false;
    } else if (ITEM.test(line)) {
      flush();
      inItem = true;
    } else if (!inItem) {
      current.push(line);
    }
  }
  flush();
  return out;
}

describe("docs/LIMITS.md: the Skylos statements name pytest", () => {
  it("AC-10: the section keeps The signals of this release catch **7 of 9**. and exactly its seven caught and two missed items, adds a pytest **8 of 9** sentence linking PRECISION.md, points always-true-matcher at the TI17 proposal, and its new text holds no 2, 4 or 5 of 9", () => {
    const now = sectionOf(read("docs/LIMITS.md"));
    const base = sectionOf(readBase("docs/LIMITS.md"));

    expect(normalize(now.join("\n")), "the vitest sentence").toContain("The signals of this release catch **7 of 9**.");

    const caughtNow = itemsOf(now).filter((item) => CAUGHT.test(item));
    const caughtBase = itemsOf(base).filter((item) => CAUGHT.test(item));
    expect(caughtBase, "the base held seven caught items").toHaveLength(7);
    expect(caughtNow, "exactly the seven caught items of the base").toEqual(caughtBase);

    const missedNow = itemsOf(now).filter((item) => MISSED.test(item));
    const missedBase = itemsOf(base).filter((item) => MISSED.test(item));
    expect(missedBase, "the base held two missed items").toHaveLength(2);
    const pair = (item: string) => (MISSED.exec(item) as RegExpExecArray).slice(1, 3);
    expect(missedNow.map(pair), "exactly the two missed cases of the base, with their planned ids").toEqual(
      missedBase.map(pair),
    );
    for (const item of missedBase.filter((i) => !i.startsWith("- `always-true-matcher`"))) {
      expect(missedNow, "the other missed item is unchanged").toContain(item);
    }
    const matcher = missedNow.filter((item) => item.startsWith("- `always-true-matcher` — missed; planned: TI17"));
    expect(matcher, "the always-true-matcher item keeps its opening").toHaveLength(1);
    expect(matcher[0], "the always-true-matcher item names the TI17 proposal subsection").toContain("TI17 proposal");

    const PRECISION_LINK = /\]\((?:\.\/)?PRECISION\.md(?:#[^)]*)?\)/;
    expect(normalize(base.join("\n")), "the base had no 8 of 9").not.toContain("8 of 9");
    const pytest = paragraphsOf(now).filter(
      (p) => /\bpytest\b/.test(p) && p.includes("**8 of 9**") && PRECISION_LINK.test(p),
    );
    expect(pytest.length, "a sentence naming pytest and **8 of 9** with a link to PRECISION.md").toBeGreaterThan(0);

    const baseLines = new Set(base);
    const added = now.filter((line) => !baseLines.has(line));
    for (const figure of ["2 of 9", "4 of 9", "5 of 9"]) {
      expect(
        added.filter((line) => line.includes(figure)),
        `no new text holds ${figure}`,
      ).toEqual([]);
    }
  });
});
