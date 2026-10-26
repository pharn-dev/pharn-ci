import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// precision-v030: docs/LIMITS.md says TI15 is an `info` signal and why (0 of 30 sampled findings right on the
// precision corpus), and names TI12's measured sample (0 of 1) as too small to judge, both linking docs/PRECISION.md.
// The file is read inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const PRECISION_LINK = /\]\((?:\.\/)?PRECISION\.md(?:#[^)\s]*)?\)/;

/** The `### ` subsection with exactly this heading line, up to the next `### ` or `## ` heading, joined. */
function h3(text: string, heading: string): string {
  const all = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const start = all.indexOf(heading);
  if (start === -1) throw new Error(`no "${heading}" heading`);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("### ") || line.startsWith("## "));
  return normalize((end === -1 ? rest : rest.slice(0, end)).join(" "));
}

describe("docs/LIMITS.md: TI15 and TI12 carry their measured samples", () => {
  it("AC-11: What TI15 misses names an `info` signal with 0 of 30 and a PRECISION.md link and drops It is a `warn` signal; What TI12 misses names 0 of 1 with a PRECISION.md link", () => {
    const text = readFileSync(join(ROOT, "docs/LIMITS.md"), "utf8");

    const ti15 = h3(text, "### What TI15 misses");
    expect(ti15).toContain("`info` signal");
    expect(ti15).toContain("0 of 30");
    expect(ti15).toMatch(PRECISION_LINK);
    expect(ti15).not.toContain("It is a `warn` signal");

    const ti12 = h3(text, "### What TI12 misses");
    expect(ti12).toMatch(/\b0 of 1\b/);
    expect(ti12).toMatch(PRECISION_LINK);
  });
});
