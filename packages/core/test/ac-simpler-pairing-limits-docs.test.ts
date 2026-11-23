import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// CORE-145 part A, AC-7. docs/LIMITS.md states the bound of the simpler pairing where a reader looks for what TI02
// misses and for the size limits: each removed test is compared with at most 256 not-yet-paired new tests per rule, in
// head order, and a test whose match lies past the bound is reported as removed. Each section is read from its heading
// to the next heading of the same or a higher level, with whitespace collapsed (so a line break may fall anywhere).

const LIMITS = fileURLToPath(new URL("../../../docs/LIMITS.md", import.meta.url));
const SENTENCE =
  "Each removed test is compared with at most 256 not-yet-paired new tests per rule, in head order; a test whose match lies past the bound is reported as removed.";

/** The text under `heading` up to the next heading of its level or higher, whitespace collapsed; throws if absent. */
function section(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.indexOf(heading);
  if (start === -1) throw new Error(`docs/LIMITS.md has no heading ${JSON.stringify(heading)}`);
  const level = (/^#+/.exec(heading)?.[0] ?? "").length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const hashes = /^(#+) /.exec(lines[i] ?? "");
    if (hashes !== null && (hashes[1] as string).length <= level) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join(" ")
    .replace(/\s+/g, " ");
}

describe("docs/LIMITS.md states the bound of the simpler pairing", () => {
  it("AC-7: the TI02 section and section 8 state that each removed test is compared with at most 256 not-yet-paired new tests per rule, in head order, and that a test whose match lies past the bound is reported as removed", () => {
    const markdown = readFileSync(LIMITS, "utf8");
    expect(section(markdown, "### What TI02 misses"), "What TI02 misses states the bound").toContain(SENTENCE);
    expect(section(markdown, "## 8. Size limits"), "section 8 states the bound").toContain(SENTENCE);
  });
});
