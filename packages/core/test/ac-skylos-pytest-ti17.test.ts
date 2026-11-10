import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Skylos nine, part 2: the always-true matcher got a written TI17 proposal as the last ### subsection of docs/LIMITS.md
// "What test integrity does not catch". Re-pinned for ti17-always-true-matcher-2: TI17 is built now, so the proposal
// became `### What TI17 misses`, still the last ### subsection, and says what TI17 reads, that it warns and never blocks
// by default, and what it misses. The document is read inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TITLE = "What test integrity does not catch";
const ITEM = /^\s*(?:[-*]|\d+\.)\s+/;
const CAUGHT = /^- `([a-z-]+)` — caught by (TI\d\d)/;
const MISSED = /^- `([a-z-]+)` — missed; planned: (TI\d\d)/;

const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** The last `### ` subsection of the `## …What test integrity does not catch` section, heading line first. */
function lastSubsection(text: string): string[] {
  const all = lines(text);
  const starts = all.flatMap((line, index) => (line.startsWith("## ") && line.includes(TITLE) ? [index] : []));
  expect(starts, `one "## …${TITLE}" heading`).toHaveLength(1);
  const rest = all.slice((starts[0] as number) + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const section = end === -1 ? rest : rest.slice(0, end);
  const subs = section.flatMap((line, index) => (line.startsWith("### ") ? [index] : []));
  if (subs.length === 0) throw new Error("the section has no ### subsection");
  return section.slice(subs.at(-1) as number);
}

/** The subsection's list items, each joined with its continuation lines and whitespace-normalized. */
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

describe("docs/LIMITS.md: what TI17 misses", () => {
  it("AC-11: the section's last ### subsection is What TI17 misses: the three things TI17 reads, severity warn and never blocks by default, what it misses, no proposal wording, and no caught or missed item", () => {
    const sub = lastSubsection(readFileSync(`${ROOT}docs/LIMITS.md`, "utf8"));
    expect(sub[0], "the heading").toBe("### What TI17 misses");
    const body = normalize(sub.slice(1).join("\n"));

    expect(body, "no longer a proposal").not.toMatch(/\bproposal\b/i);
    expect(body, "no longer unimplemented").not.toMatch(/\bnot implemented\b/i);

    // The three things TI17 reads.
    expect(body, "a custom matcher defined through expect.extend").toContain("expect.extend");
    expect(body, "whose pass").toMatch(/\bpass\b/);
    expect(body, "is constant").toMatch(/\b(?:constant|always)\b/i);
    expect(body, "true").toMatch(/\btrue\b/);
    expect(body, "a Python helper returning True").toMatch(/\bhelper\b/i);
    expect(body, "a Python helper returning True").toContain("True");
    expect(body, "used in an assert").toContain("assert");
    expect(body, "expect.anything()").toContain("expect.anything()");
    expect(body, "mock.ANY").toContain("mock.ANY");

    expect(body, "the severity is warn").toMatch(/\bwarns?\b/i);
    expect(body, "and never blocks by default").toMatch(/never blocks? by default/);

    // must-trigger and must-not-trigger, each followed by at least one case.
    const trigger = body.search(/must-trigger/);
    const notTrigger = body.search(/must-not-trigger/);
    expect(trigger, "names must-trigger").toBeGreaterThan(-1);
    expect(notTrigger, "names must-not-trigger").toBeGreaterThan(-1);
    const after = (from: number, keyword: string) => {
      const start = from + keyword.length;
      const stops = [trigger, notTrigger].filter((i) => i > from);
      return body.slice(start, stops.length > 0 ? Math.min(...stops) : undefined);
    };
    expect(after(trigger, "must-trigger"), "a case after must-trigger").toMatch(/`[^`]+`/);
    expect(after(notTrigger, "must-not-trigger"), "a case after must-not-trigger").toMatch(/`[^`]+`/);

    expect(body, "says what TI17 misses").toMatch(/\bmisses\b/i);

    const items = itemsOf(sub);
    expect(
      items.filter((item) => CAUGHT.test(item) || MISSED.test(item)),
      "no caught or missed item in the subsection",
    ).toEqual([]);
  });
});
