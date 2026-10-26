import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// precision-v030: the Official results subsection of docs/PRECISION.md lists every false block of
// fixtures/corpus/review.csv with a pointer into docs/LIMITS.md, every true block, and the decisions (no block signal
// demoted, TI15 to info, TI12 at 0 of 1). The block PRs are read from the CSV, not typed into the test alone.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

type Row = Record<string, string>;
type Lib = { parseCsv: (text: string) => Row[] };

const load = async (): Promise<Lib> =>
  (await import(pathToFileURL(join(ROOT, "scripts/corpus-lib.mjs")).href)) as unknown as Lib;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** The lines of the `## ` section whose heading starts with `prefix`, after the heading, up to the next `## `. */
function h2Section(text: string, prefix: string): string[] {
  const all = lines(text);
  const start = all.findIndex((line) => line.startsWith(prefix));
  if (start === -1) throw new Error(`no heading starting "${prefix}"`);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

/** Every `### ` subsection of `section` whose heading contains `needle`, each up to the next `### ` or `## `. */
function h3Subsections(section: string[], needle: string): string[][] {
  const out: string[][] = [];
  section.forEach((line, i) => {
    if (!line.startsWith("### ") || !line.includes(needle)) return;
    const rest = section.slice(i + 1);
    const end = rest.findIndex((l) => l.startsWith("### ") || l.startsWith("## "));
    out.push(end === -1 ? rest : rest.slice(0, end));
  });
  return out;
}

/** The list items (`-`, `*`, `+` or `1.`, any indent), each joined with its continuation lines. */
function listItems(sub: string[]): string[] {
  const out: string[] = [];
  let current: string | null = null;
  const flush = () => {
    if (current !== null) out.push(normalize(current));
    current = null;
  };
  for (const line of sub) {
    const item = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      flush();
      current = item[1] as string;
    } else if (current !== null && line.trim() !== "" && !/^\s*(?:#|\|)/.test(line)) {
      current += ` ${line.trim()}`;
    } else flush();
  }
  flush();
  return out;
}

/** The paragraphs (runs of non-blank lines), each joined. */
function paragraphs(sub: string[]): string[] {
  const out: string[] = [];
  let current: string[] = [];
  for (const line of sub) {
    if (line.trim() === "") {
      if (current.length > 0) out.push(normalize(current.join(" ")));
      current = [];
    } else current.push(line);
  }
  if (current.length > 0) out.push(normalize(current.join(" ")));
  return out;
}

const LIMITS_LINK = /\]\((?:\.\/)?LIMITS\.md(?:#[^)\s]*)?\)/;

describe("docs/PRECISION.md Official results: the blocks and the decisions", () => {
  it("AC-6: lists each false block with a LIMITS.md pointer and each true block, and states that no block signal is demoted, that TI15 becomes info, and TI12 at 0 of 1", async () => {
    const { parseCsv } = await load();
    const blocks = parseCsv(read("fixtures/corpus/review.csv")).filter((row) => row.severity === "block");
    const keys = (verdict: string) =>
      [
        ...new Set(blocks.filter((row) => row.verdict === verdict).map((row) => `${row.repo}#${row.pr} ${row.signal}`)),
      ].sort();
    expect(keys("FP")).toEqual(["honojs/hono#5466 TI11", "shadcn-ui/ui#11247 TI01", "shadcn-ui/ui#11307 TI02"]);
    expect(keys("TP")).toEqual(["honojs/hono#5236 TI02", "shadcn-ui/ui#12297 TI02"]);

    const subs = h3Subsections(h2Section(read("docs/PRECISION.md"), "## 2. Precision corpus"), "Official results");
    expect(subs, "exactly one ### subsection whose heading contains Official results").toHaveLength(1);
    const sub = subs[0] as string[];
    const items = listItems(sub);

    const pointer: Record<string, (item: string) => boolean> = {
      TI01: (item) => item.includes("What TI01 misses") && LIMITS_LINK.test(item),
      TI02: (item) => item.includes("LIMITS.md#what-ti02-misses"),
      TI11: (item) => item.includes("LIMITS.md#what-ti11-misses"),
    };
    for (const key of keys("FP")) {
      const [ref, signal] = key.split(" ") as [string, string];
      const check = pointer[signal];
      expect(check, `a LIMITS.md pointer is defined for ${signal}`).toBeDefined();
      const found = items.filter(
        (item) => item.includes(ref) && item.includes(signal) && (check as (i: string) => boolean)(item),
      );
      expect(found.length, `a list item for the false block ${key} with its LIMITS.md pointer`).toBeGreaterThan(0);
    }
    for (const key of keys("TP")) {
      const [ref, signal] = key.split(" ") as [string, string];
      const found = items.filter((item) => item.includes(ref) && item.includes(signal));
      expect(found.length, `a list item for the true block ${key}`).toBeGreaterThan(0);
    }

    const plain = (text: string) => text.replaceAll("`", "");
    const blocksOfText = [...items, ...paragraphs(sub)].map(plain);
    const whole = plain(normalize(sub.join(" ")));
    expect(whole, "states that no block signal is demoted").toMatch(/no block signal is demoted/i);
    expect(whole, "states that TI15 becomes info").toMatch(/TI15 becomes info/i);
    expect(
      blocksOfText.some((text) => text.includes("TI12") && /\b0 of 1\b/.test(text)),
      "names TI12 with 0 of 1",
    ).toBe(true);
  });
});
