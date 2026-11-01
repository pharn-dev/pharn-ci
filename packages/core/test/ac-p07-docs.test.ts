import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// E3 item 24 (P07), AC-21. Reads the repository's docs and one source comment as text; nothing the build adds is
// loaded. Prose is compared with its whitespace collapsed (a phrase may wrap across lines) and its curly apostrophes
// made straight.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const flat = (text: string) => text.replace(/[‘’]/g, "'").replace(/\s+/g, " ");

/** The text from the line `heading` to the next heading of the same or a higher level. */
function section(text: string, heading: string): string {
  const level = /^#+/.exec(heading)?.[0].length ?? 2;
  const lines = text.split("\n");
  const at = lines.indexOf(heading);
  expect(at, heading).toBeGreaterThanOrEqual(0);
  const next = lines.findIndex((l, i) => {
    if (i <= at) return false;
    const m = /^(#+) /.exec(l);
    return m !== null && (m[1] as string).length <= level;
  });
  return lines.slice(at, next === -1 ? undefined : next).join("\n");
}

/** The top-level bullets of a markdown block, each with its indented continuation lines. */
function bullets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) out.push(line);
    else if (line.startsWith("  ") && out.length > 0) out[out.length - 1] += `\n${line}`;
  }
  return out;
}

describe("the docs for rule P07", () => {
  it("AC-21: README, THREAT-MODEL, LIMITS, CHANGELOG and the SECRET_SCAN_KINDS comment describe P07, its read of the agent instruction files and A7's unchanged scope", () => {
    const readme = read("README.md");

    // README ### Policy mode inside ## What it proves, and what it does not. Re-pinned when E3 item 24 (P07) was rebased
    // onto E3 item 23 (policy settings), whose Org policy section has its own "### Policy mode": this one is renamed so
    // the two headings get distinct anchors.
    const proves = section(readme, "## What it proves, and what it does not");
    expect(proves.split("\n")).toContain("### Policy mode: agent instruction files");
    const policyMode = section(proves, "### Policy mode: agent instruction files");
    const modeFlat = flat(policyMode);
    for (const term of ["P07", "`HEAD`", "200 files", "512 KiB", "16 MiB"]) expect(modeFlat, term).toContain(term);
    expect(modeFlat).toMatch(/uploaded/i);
    expect(modeFlat).toMatch(/printed/i);
    expect(modeFlat).toMatch(/\b(nothing|never|not)\b[^.]*\b(uploaded|printed)\b/i);

    // README ## Secrets in agent configs: the Markdown kinds are never read by A7.
    expect(flat(section(readme, "## Secrets in agent configs"))).toContain("never read by A7");

    // README ## Org policy names P07 and setup.consistency.
    const orgPolicy = section(readme, "## Org policy");
    expect(orgPolicy).toContain("P07");
    expect(orgPolicy).toContain("setup.consistency");

    // THREAT-MODEL rows A1, C4 and C6, the Policy mode paragraph and residual 35. Re-pinned on the rebase onto E3 item 23
    // (policy settings), which took row C5 and residuals 30 to 34: P07's row is C6 and its residual 35.
    const threat = read("docs/THREAT-MODEL.md");
    const lines = threat.split("\n");
    const row = (id: string) => lines.find((l) => new RegExp(`^\\| ${id} +\\|`).test(l)) ?? "";
    expect(row("A1")).toContain("agent instruction text");
    expect(row("C4")).toContain("Check A7 reads only the machine-readable kinds");
    const c6 = row("C6");
    expect(c6, "row C6").not.toBe("");
    expect(c6).toContain("cat-file");
    expect(c6).toContain("P07");
    expect(c6).toMatch(/\| Enforced today \|\s*$/);
    const residuals = lines.findIndex((l) => l.startsWith("## 3."));
    expect(residuals, "## 3. in THREAT-MODEL").toBeGreaterThan(0);
    const tableEnd = lines.reduce((last, l, i) => (i < residuals && /^\| [A-Z]\d+ +\|/.test(l) ? i : last), -1);
    const policyMode2 = lines.indexOf("### Policy mode");
    expect(policyMode2, "### Policy mode in THREAT-MODEL").toBeGreaterThan(tableEnd);
    expect(policyMode2).toBeLessThan(residuals);
    expect(lines.some((l) => l.startsWith("35. **P07 reads the text of the agent instruction files.**"))).toBe(true);

    // LIMITS: ### What P07 misses under ## Org policy, and the applied-keys bullet.
    const limits = read("docs/LIMITS.md");
    const limitsPolicy = section(limits, "## Org policy");
    expect(limitsPolicy.split("\n")).toContain("### What P07 misses");
    const misses = flat(section(limitsPolicy, "### What P07 misses"));
    expect(misses).toContain("pytest");
    expect(misses).toMatch(/prose/i);
    expect(misses).toMatch(/same[- ]directory/i);
    const applied = bullets(limitsPolicy).find((b) => b.startsWith("- **Only some keys are applied.**"));
    expect(applied, "the Only some keys are applied bullet").toBeDefined();
    expect(applied).toContain("setup.consistency");
    expect(applied).toContain("P07");

    // CHANGELOG Unreleased: one Added bullet and one Security bullet for P07.
    const unreleased = section(read("CHANGELOG.md"), "## [0.4.0] - 2026-10-27");
    const under = (heading: string) => bullets(section(unreleased, heading));
    expect(under("### Added").filter((b) => b.startsWith("- Org policy rule P07"))).toHaveLength(1);
    expect(
      under("### Security").filter((b) => b.includes("P07") && flat(b).includes("agent instruction files")),
    ).toHaveLength(1);

    // The SECRET_SCAN_KINDS comment.
    const scan = read("packages/core/src/secrets/scan.ts");
    const kinds = scan.indexOf("export const SECRET_SCAN_KINDS");
    expect(kinds).toBeGreaterThan(0);
    const comment = scan.slice(scan.lastIndexOf("/**", kinds), kinds);
    expect(flat(comment.replace(/^\s*\*/gm, " "))).toContain("never read by the secret scan");
  });
});
