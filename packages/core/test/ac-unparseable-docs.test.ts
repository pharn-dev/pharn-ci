import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// settings-unparseable-fails-closed (review A3-F2), AC-7 and AC-8: the threat model and the changelog say that an
// unparseable or binary agent settings or MCP file is an error whatever the policy lists.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(ROOT + path, "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

function c5Row(): string {
  const row = read("docs/THREAT-MODEL.md")
    .split("\n")
    .find((line) => /^\| C5\s+\|/.test(line));
  if (row === undefined) throw new Error("docs/THREAT-MODEL.md has no row C5");
  return row;
}

/**
 * The bullets of `## [0.5.0] - 2026-11-03` → `### Security`, each folded onto one line. Shipped in 0.5.0: the release
 * PR moved the Unreleased entries under that heading.
 */
function unreleasedSecurityBullets(): string[] {
  const lines = read("CHANGELOG.md").split("\n");
  const start = lines.indexOf("## [0.5.0] - 2026-11-03");
  if (start === -1) throw new Error("CHANGELOG.md has no ## [0.5.0] - 2026-11-03 section");
  const after = lines.slice(start + 1);
  const end = after.findIndex((line) => /^## /.test(line));
  const section = end === -1 ? after : after.slice(0, end);
  const security = section.indexOf("### Security");
  if (security === -1) throw new Error("## [0.5.0] - 2026-11-03 has no ### Security subsection");
  const rest = section.slice(security + 1);
  const stop = rest.findIndex((line) => /^### /.test(line));
  const body = stop === -1 ? rest : rest.slice(0, stop);
  const bullets: string[] = [];
  for (const line of body) {
    if (line.startsWith("- ")) bullets.push(line.slice(2));
    else if (/^\s+\S/.test(line) && bullets.length > 0) bullets[bullets.length - 1] += ` ${line.trim()}`;
  }
  return bullets.map(flat);
}

describe("docs for unparseable settings and MCP files failing closed", () => {
  it("AC-7: THREAT-MODEL row C5 says a refused or binary settings or MCP file is an error whatever the lists, and keeps its pins", () => {
    const row = c5Row();
    // The new statement.
    expect(row).toMatch(/too[- ]deep/i);
    expect(row).toMatch(/not JSON/i);
    expect(row).toMatch(/not an object/i);
    expect(row).toMatch(/binary/i);
    expect(row).toMatch(/whatever the (?:policy(?:'s)? )?lists/i);
    expect(row).toMatch(/counts? against the repository/i);
    expect(row).toMatch(/cannot loosen the policy/i);
    expect(row).toMatch(/unparseable/i);
    // The existing pins still hold.
    expect(row).toMatch(/settings/i);
    expect(row).toMatch(/MCP/);
    expect(row).toMatch(/HEAD/);
    expect(row).toMatch(/symlink/i);
    expect(row).toMatch(/\b64\b/);
    expect(row).toMatch(/budget/i);
    expect(row).toMatch(/never echoed|never written|never quoted/i);
    expect(row).not.toContain("JSON.parse");
  });

  it("AC-8: CHANGELOG [Unreleased] Security holds one A3-F2 bullet describing the deliberate tightening", () => {
    const bullets = unreleasedSecurityBullets().filter((bullet) => bullet.includes("A3-F2"));
    expect(bullets).toHaveLength(1);
    const bullet = bullets[0] as string;
    expect(bullet).toMatch(/unparseable/i);
    expect(bullet).toMatch(/binary/i);
    expect(bullet).toMatch(/settings/i);
    expect(bullet).toMatch(/MCP/);
    expect(bullet).toMatch(/errors?/i);
    expect(bullet).toMatch(/whatever the (?:policy(?:'s)? )?lists/i);
    expect(bullet).toMatch(/P09 blocks/);
    expect(bullet).toMatch(/verdict fails/i);
    expect(bullet).toMatch(/deliberate tightening/i);
    expect(bullet).toMatch(/already broken/i);
    expect(bullet).toMatch(/now fails where it warned/i);
    expect(bullet).toMatch(/P02 is in force under every policy/i);
    expect(bullet).toMatch(/no schema change/i);
    expect(bullet).toMatch(/no new message code/i);
  });
});
