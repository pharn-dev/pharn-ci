import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// E3 item 23 (policy settings), AC-30. The documents are read inside the test body: the build edits them after this
// test is written. The base is main at 93376a9 (E3 item 22 merged), read with git.

const BASE = "93376a9";
const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const atBase = (path: string) =>
  execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** The text from the `heading` line up to the next heading of the same or a higher level. */
function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  expect(start, `the ${heading} heading`).toBeGreaterThan(-1);
  const level = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+) /.exec(lines[i] as string);
    if (m !== null && (m[1] as string).length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** The §2 table row whose first cell is `id`. */
const row = (text: string, id: string) => text.split("\n").find((l) => new RegExp(`^\\| ${id}\\s+\\|`).test(l));

/** The §3 residuals: number, title and the full text up to the next residual or heading. */
function residuals(text: string): { n: number; title: string; body: string }[] {
  const named = section(text, "## 3. Named residual risks").split("\n");
  const out: { n: number; title: string; body: string }[] = [];
  for (const line of named) {
    const m = /^(\d+)\. \*\*(.+?)\*\*/.exec(line);
    if (m !== null) out.push({ n: Number(m[1]), title: m[2] as string, body: line });
    else if (out.length > 0 && !line.startsWith("#")) (out[out.length - 1] as { body: string }).body += `\n${line}`;
  }
  return out;
}

describe("THREAT-MODEL, LIMITS and CHANGELOG for policy mode", () => {
  it("AC-30: row C5 and the A1 parse list, residuals appended from 28, What P02–P06 miss under Org policy, the keys bullet updated, and one Unreleased bullet", () => {
    // THREAT-MODEL §2: row C5 after C4, and A1's parse list.
    const threat = read("docs/THREAT-MODEL.md");
    const lines = threat.split("\n");
    const c4 = lines.findIndex((l) => /^\| C4\s+\|/.test(l));
    const c5 = lines.findIndex((l) => /^\| C5\s+\|/.test(l));
    expect(c4, "row C4").toBeGreaterThan(-1);
    expect(c5, "row C5 right after C4").toBe(c4 + 1);
    const rowC5 = lines[c5] as string;
    for (const word of [
      /settings/i,
      /MCP/,
      /HEAD/,
      /symlink/i,
      /\b64\b/,
      /budget/i,
      /never echoed|never written|never quoted/i,
    ]) {
      expect(rowC5, `row C5 matches ${word}`).toMatch(word);
    }
    expect(rowC5.includes("-I -S -B"), "row C5 does not mention -I -S -B").toBe(false);
    expect(rowC5.includes("duplicate") && rowC5.includes("JSON.parse")).toBe(false);
    expect(row(threat, "A1"), "row A1 names the agent settings and MCP JSON").toContain("agent settings and MCP JSON");

    // THREAT-MODEL §3: residuals 1–27 unchanged (there is no residual 7), the new ones appended from 28 without a gap.
    const before = residuals(atBase("docs/THREAT-MODEL.md"));
    const now = residuals(threat);
    expect(before.map((r) => r.n)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1).filter((n) => n !== 7));
    expect(now.slice(0, before.length).map((r) => [r.n, r.title])).toEqual(before.map((r) => [r.n, r.title]));
    const added = now.slice(before.length);
    expect(added.length, "new residuals").toBeGreaterThanOrEqual(1);
    expect(added.map((r) => r.n)).toEqual(added.map((_, i) => 28 + i));
    const addedText = added.map((r) => r.body).join("\n");
    for (const word of [/text guards?/i, /trust prompt/i, /claude -p/, /unknown/i, /lags?\b/i]) {
      expect(addedText, `the new residuals match ${word}`).toMatch(word);
    }
    for (const r of added) {
      expect(r.body.includes("duplicate") && r.body.includes("JSON.parse"), `residual ${r.n}`).toBe(false);
    }

    // LIMITS: What P02–P06 miss under Org policy, and the keys bullet updated.
    const limits = read("docs/LIMITS.md");
    const org = section(limits, "## Org policy");
    const miss = section(org, "### What P02–P06 miss");
    for (const word of [
      "~/.claude",
      /managed settings/i,
      /plugins?/i,
      /frontmatter/i,
      "settings.local.json",
      /subdirectory/i,
      /regex/i,
      "Bash(git *)",
      /JSONC/,
      "defaultMode",
      /sandbox/i,
    ]) {
      if (typeof word === "string") expect(miss, `What P02–P06 miss names ${word}`).toContain(word);
      else expect(miss, `What P02–P06 miss matches ${word}`).toMatch(word);
    }
    const keys = (text: string) =>
      section(text, "## Org policy")
        .split("\n- ")
        .find((b) => b.startsWith("**Only some keys are applied."));
    const keysNow = keys(limits);
    expect(keysNow, "the Only some keys are applied bullet").toBeDefined();
    expect(keysNow, "the bullet changed").not.toBe(keys(atBase("docs/LIMITS.md")));
    expect(keysNow, "policy.rules now reaches P02–P06").toMatch(/P02|P06/);

    // CHANGELOG: exactly one Unreleased Added bullet for this item.
    const changelog = read("CHANGELOG.md");
    const unreleased = section(changelog, "## [Unreleased]");
    const addedSection = section(unreleased, "### Added");
    const bullets = addedSection
      .split("\n- ")
      .slice(1)
      .map((b) => `- ${b}`);
    const ours = bullets.filter((b) => b.startsWith("- Org policy rules P02–P06"));
    expect(ours, "one bullet starting - Org policy rules P02–P06").toHaveLength(1);
    for (const word of ["OIDC", "POLICY_P08", "POLICY_P09"]) {
      expect((ours[0] as string).includes(word), `the bullet does not name ${word}`).toBe(false);
    }
  });
});
