import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// release-readiness-v020: docs/LIMITS.md gains "What test integrity does not catch" and section 1's stale
// "not detected yet" sentence is corrected. Files are read inside each test body, so a missing section fails only
// its own test.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Current main before this increment: the base for the "still present" checks. */
const BEFORE = "b2c3a56373046ee6b64f913581a645f98240310c";
const TITLE = "What test integrity does not catch";
const ACCEPT_MISSES = "### What the accept label misses";

const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const readBefore = (path: string) =>
  execFileSync("git", ["show", `${BEFORE}:${path}`], { cwd: ROOT, encoding: "utf8" });
const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** The section's lines: from its one `## ` heading to the line before the next `## ` heading. */
function limitsSection(text: string): { lines: string[]; start: number } {
  const all = lines(text);
  const headings = all.flatMap((line, index) => (line.startsWith("## ") && line.includes(TITLE) ? [index] : []));
  expect(headings, `one "## …${TITLE}" heading`).toHaveLength(1);
  const start = headings[0] as number;
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return { lines: [all[start] as string, ...(end === -1 ? rest : rest.slice(0, end))], start };
}

const ITEM = /^\s*(?:[-*]|\d+\.)\s+/;

/** List items, each with its continuation lines joined and whitespace normalized (marker kept as `- `). */
function listItems(section: string[]): string[] {
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

const CAUGHT = /^- `([a-z-]+)` — caught by (TI\d\d)/;
const MISSED = /^- `([a-z-]+)` — missed; planned: (TI\d\d)/;

const MISSED_CASES: ReadonlyArray<[string, string]> = [
  ["deselect-setting", "TI09"],
  ["hard-coded-answer", "TI15"],
  ["always-true-matcher", "TI17"],
  ["loosened-assertion", "TI06"],
  ["edited-expected-value", "TI07"],
];

describe("release-readiness-v020: docs/LIMITS.md", () => {
  it("AC-1: one 'What test integrity does not catch' section after the accept-label misses, naming the seven signals, the accept label, Skylos 2 of 9, the two caught cases and the seven missed cases with their planned signals", () => {
    const text = read("docs/LIMITS.md");
    const { lines: section, start } = limitsSection(text);
    const acceptIndex = lines(text).indexOf(ACCEPT_MISSES);
    expect(acceptIndex, ACCEPT_MISSES).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(acceptIndex);

    const body = normalize(section.join("\n"));
    for (const id of ["TI01", "TI02", "TI03", "TI04", "TI05", "TI10", "TI11", "TI13", "TI14"]) {
      expect(body).toContain(id);
    }
    expect(body).toMatch(/accept label/i);
    expect(body).toContain("Skylos");
    expect(body).toContain("4 of 9");

    const items = listItems(section);
    const caught = new Map<string, string>();
    const missed = new Map<string, string>();
    for (const item of items) {
      const c = CAUGHT.exec(item);
      if (c) caught.set(c[1] as string, c[2] as string);
      const m = MISSED.exec(item);
      if (m) missed.set(m[1] as string, m[2] as string);
    }
    expect(caught.get("deleted-test"), items.join("\n")).toBe("TI01");
    expect(caught.get("added-skip"), items.join("\n")).toBe("TI03");
    expect(caught.get("emptied-assertion"), items.join("\n")).toBe("TI05");
    expect(caught.get("replaced-test"), items.join("\n")).toBe("TI02");
    for (const [name, id] of MISSED_CASES) expect(missed.get(name), `${name}\n${items.join("\n")}`).toBe(id);
  });

  it("AC-2: the section names a same-name replacement with a trivial body, toEqual(expectedFromOutput), mocks in setup files, and calls the unbuilt signals planned", () => {
    const body = normalize(limitsSection(read("docs/LIMITS.md")).lines.join("\n"));
    expect(body).toMatch(/same name/i);
    expect(body).toMatch(/trivial body/i);
    expect(body).toContain("toEqual(expectedFromOutput)");
    expect(body).toMatch(/mock/i);
    expect(body).toMatch(/setup file/i);
    expect(body).toMatch(/planned/i);
  });

  it("AC-4: the stale 'not detected yet' sentence is gone and every ## and ### heading of the base copy is still present", () => {
    const now = read("docs/LIMITS.md");
    const before = readBefore("docs/LIMITS.md");
    expect(normalize(now)).not.toContain(
      "Weakened, skipped or focused tests inside a file and deleted test cases are not detected yet",
    );
    const nowLines = new Set(lines(now));
    const headings = lines(before).filter((line) => line.startsWith("## ") || line.startsWith("### "));
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) expect(nowLines.has(heading), heading).toBe(true);
  });
});
