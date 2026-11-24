import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// CORE-356 (AC-11). docs/LIMITS.md's "What TI03 misses" section, read as text: it names no pythonAliases.ts, and it
// states (1) that a base the Python index refuses (case B) and a base dropped as `missing` while the head has text
// (case C) compare the head's skips against a base with no skip, (2) that the head-missing case C is not compared, and
// (3) that an aliased spelling is not resolved for a side the Python index did not index. Each statement is looked for
// inside one bullet of the section, with the words it must hold; the wording around them is free.

const LIMITS = fileURLToPath(new URL("../../../docs/LIMITS.md", import.meta.url));
const HEADING = "### What TI03 misses";

/** The section from its heading to the next heading of level 2 or 3. */
function section(): string {
  const text = readFileSync(LIMITS, "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf(`\n${HEADING}\n`);
  if (start === -1) throw new Error(`docs/LIMITS.md has no "${HEADING}" heading`);
  const rest = text.slice(start + 1 + HEADING.length);
  const end = rest.search(/\n#{2,3} /);
  return end === -1 ? rest : rest.slice(0, end);
}

/** The section's bullets (and its opening paragraph), whitespace folded, backticks dropped, lower case. */
function bullets(body: string): string[] {
  return body
    .split(/\n- /)
    .map((b) => b.replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter((b) => b !== "");
}

describe("CORE-356: docs/LIMITS.md states what TI03 does when the Python index does not read a side", () => {
  it("AC-11: the What TI03 misses section names no pythonAliases.ts, states the B and base-missing C behaviour (head skips counted against a base with no skip), the head-missing C case as not compared, and that an aliased spelling is not resolved for a side the Python index did not index", () => {
    const body = section();
    const list = bullets(body);
    expect(list.length, "the section has bullets").toBeGreaterThan(3);

    expect(body, "no pythonAliases.ts").not.toContain("pythonAliases.ts");
    expect(body, "no pythonAliases module named at all").not.toContain("pythonAliases");

    const baseUnread = list.filter(
      (b) => b.includes("a base with no skip") && /refus/.test(b) && b.includes("missing") && b.includes("head"),
    );
    expect(
      baseUnread.length,
      "a bullet states that a refused base (B) and a base dropped as missing (C) compare the head's skips against a base with no skip",
    ).toBeGreaterThan(0);

    const headMissing = list.filter((b) => b.includes("missing") && b.includes("head") && b.includes("not compared"));
    expect(headMissing.length, "a bullet states the head-missing case as not compared").toBeGreaterThan(0);

    const aliasUnresolved = list.filter(
      (b) =>
        /alias/.test(b) &&
        /not resolved|resolves no|is not read|are not read|not read/.test(b) &&
        /did not index|does not index|not indexed|did not run|does not run|refus/.test(b),
    );
    expect(
      aliasUnresolved.length,
      "a bullet states that an aliased spelling is not resolved for a side the Python index did not index",
    ).toBeGreaterThan(0);
  });
});
