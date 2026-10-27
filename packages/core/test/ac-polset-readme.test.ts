import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// E3 item 23 (policy settings), AC-29. README.md is read inside the test body: the build edits it after this test is
// written.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const CODES = ["POLICY_P02", "POLICY_P03", "POLICY_P04", "POLICY_P05", "POLICY_P06", "POLICY_SETTINGS_INVALID"];

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

describe("README: policy mode", () => {
  it("AC-29: Org policy has a Policy mode subsection naming the files, the rules, the fixed checks, what never leaves the job, POLICY_SETTINGS_INVALID, /x and //x, and the bold text-guard warning; the code table has the six codes; the inventory bullet and the intro are updated", () => {
    const readme = read("README.md");
    const org = section(readme, "## Org policy");
    expect(org.includes("carried for later"), "the intro no longer says the other keys are carried for later").toBe(
      false,
    );

    const mode = section(org, "### Policy mode");
    for (const name of [
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".mcp.json",
      ".cursor/mcp.json",
      ".vscode/mcp.json",
      "POLICY_SETTINGS_INVALID",
      "bypassPermissions",
      "additionalDirectories",
      "enableAllProjectMcpServers",
      "disableAllHooks",
      "Edit(//etc/**)",
    ]) {
      expect(mode, `Policy mode names ${name}`).toContain(name);
    }
    for (const id of ["P02", "P03", "P04", "P05", "P06"]) expect(mode, `Policy mode names ${id}`).toContain(id);
    expect(mode, "root and nested settings files").toMatch(/nested/i);
    expect(mode, "the last two MCP files are a cross-tool scan").toMatch(/cross-tool/i);
    expect(mode, "read only when the policy lists MCP servers").toMatch(/MCP servers/);
    expect(mode, "at HEAD").toMatch(/\bHEAD\b/);
    expect(mode, "nothing read leaves the job").toMatch(/leaves the job/i);
    expect(mode, "/x is relative to the settings file's project directory").toMatch(/`\/x`/);
    expect(mode, "//x is absolute").toMatch(/`\/\/x`/);
    expect(mode, "an unparseable file is never a crash").toMatch(/unparseable/i);
    expect(mode, "the bold warning").toMatch(/\*\*P02–P06 are text guards, not a security boundary\.?\*\*/);
    expect(mode, "sandboxing is the boundary").toMatch(/sandbox/i);

    for (const code of CODES) {
      expect(readme, `a message-code table row for ${code}`).toMatch(new RegExp(`^\\| \`${code}\` \\|`, "m"));
    }
    expect(readme).toMatch(/^\| `POLICY_P09` \|/m);

    const bullet = readme.split("\n").find((l) => l.startsWith("- **The inventory is not a review.**"));
    expect(bullet, "the inventory bullet").toBeDefined();
    const at = readme.indexOf(bullet as string);
    const paragraph = readme.slice(
      at,
      readme.indexOf("\n- ", at + 1) === -1 ? undefined : readme.indexOf("\n- ", at + 1),
    );
    for (const word of ["inventory", "A7", "machine-readable"])
      expect(paragraph, `the bullet keeps ${word}`).toContain(word);
    expect(paragraph, "the bullet says policy mode reads the settings and MCP files").toMatch(/policy mode/i);
  });
});
