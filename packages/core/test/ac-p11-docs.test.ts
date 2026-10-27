import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// E3 item 24a part B (P11), AC-23. Reads the repository's docs as text; nothing the build adds is loaded. Prose is
// compared with its whitespace collapsed (a phrase may wrap across lines) and its curly apostrophes made straight.

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

describe("the docs for rule P11 and detection on every pull request run", () => {
  it("AC-23: README, THREAT-MODEL, LIMITS and CHANGELOG describe P11, the policy's agent lists, the fail-closed cases and Dependabot/Renovate", () => {
    const readme = read("README.md");

    // README ### Agent PRs.
    const agentPrs = section(readme, "### Agent PRs");
    const agentFlat = flat(agentPrs);
    expect(agentFlat).toMatch(/detection runs on every pull request run/i);
    expect(agentPrs).toContain("`agents.labels`");
    expect(agentPrs).toContain("`agents.extra_logins`");
    expect(agentFlat).toMatch(/add to the defaults/i);
    expect(agentFlat).toMatch(/an edited policy file whose base cannot be read/i);
    expect(agentFlat).toMatch(/P11 uses (it|the flag)/);
    for (const term of ["meta.isAgentPr", "ai-generated", "250"]) expect(agentPrs, term).toContain(term);

    // README ## Org policy.
    const orgPolicy = section(readme, "## Org policy");
    const orgFlat = flat(orgPolicy);
    for (const term of ["P11", "`agents.protected_paths`", "protected_paths_mode"])
      expect(orgPolicy, term).toContain(term);
    expect(orgFlat).toMatch(/a person's pull request is never subject to P11/i);
    expect(orgFlat).toMatch(/a missing diff fails closed/i);
    expect(orgFlat).toMatch(/a `file:` policy always blocks/i);
    expect(orgFlat).toMatch(/Dependabot and Renovate count as agent PRs/);
    expect(orgFlat).toMatch(/do not protect files those bots must update/i);

    // README message-code table.
    expect(readme).toMatch(/^\| `POLICY_P11` +\|/m);
    expect(readme).toMatch(/^\| `AGENT_PR_DETECTION_INCOMPLETE` +\|/m);

    // THREAT-MODEL rows D1 and A7, residuals 28 and 29.
    const threat = read("docs/THREAT-MODEL.md");
    const row = (id: string) => threat.split("\n").find((l) => new RegExp(`^\\| ${id} +\\|`).test(l)) ?? "";
    const d1 = row("D1");
    expect(d1).toContain("every pull request run");
    expect(d1).toContain("GET /repos/{owner}/{repo}/pulls/{n}/commits");
    expect(row("A7")).toMatch(/merge[- ]base/i);
    const lines = threat.split("\n");
    expect(lines.some((l) => l.startsWith("28. **P11 is a path guard on a metadata signal.**"))).toBe(true);
    expect(lines.some((l) => l.startsWith("29. **Fail-closed classification can block a person's PR.**"))).toBe(true);

    // LIMITS ### What P11 misses names Dependabot.
    const misses = section(read("docs/LIMITS.md"), "### What P11 misses");
    expect(misses).toContain("Dependabot");

    // CHANGELOG Unreleased: one Added, one Changed and one Security bullet.
    const changelog = read("CHANGELOG.md");
    const unreleased = section(changelog, "## [Unreleased]");
    const under = (heading: string) => bullets(section(unreleased, heading));
    expect(under("### Added").filter((b) => b.startsWith("- Org policy rule P11"))).toHaveLength(1);
    expect(
      under("### Changed").filter((b) => b.startsWith("- Agent PR detection runs on every pull request run")),
    ).toHaveLength(1);
    expect(
      under("### Security").filter((b) =>
        b.startsWith("- A `file:` org policy that the pull request edits is also read at the merge base"),
      ),
    ).toHaveLength(1);
  });
});
