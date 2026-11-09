import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// d05-private-registry-allowlist, AC-14: the README documents the Action input, the CLI flag and the policy key, each
// with the host-name rules (an exact host name with no scheme, path, port, user name or wildcard, at most 50, and the
// URL still https), and schema/policy.v1.json describes dependencies.allowed_hosts with its tighten rule.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["exact host", /\bexact/i],
  ["no scheme", /scheme/i],
  ["no path", /\bpath/i],
  ["no port", /\bport\b/i],
  ["no user name", /\buser/i],
  ["no wildcard", /wildcard/i],
  ["at most 50", /\b50\b/],
  ["https only", /\bhttps\b/i],
];

function expectRules(place: string, text: string) {
  expect(text.trim().length, `${place} is missing`).toBeGreaterThan(0);
  for (const [rule, pattern] of RULES) expect(text, `${place}: ${rule}`).toMatch(pattern);
}

/** The README section that starts with `heading`, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return "";
  const level = heading.indexOf(" ");
  let fenced = false;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith("```")) fenced = !fenced;
    else if (!fenced && /^#{1,6} /.test(line) && line.indexOf(" ") <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** The bullet that starts with `prefix`, with its continuation lines. */
function bullet(markdown: string, prefix: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith(prefix));
  if (start === -1) return "";
  const out = [lines[start] as string];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.startsWith("- ") || !line.startsWith(" ")) break;
    out.push(line);
  }
  return out.join("\n");
}

describe("the allowed hosts in the documentation", () => {
  it("AC-14: README documents dependency-allowed-hosts, --dependency-allowed-host and dependencies.allowed_hosts, each with the host-name rules", () => {
    const readme = read("README.md");
    const row = readme.split("\n").find((line) => line.startsWith("| `dependency-allowed-hosts`")) ?? "";
    expectRules("the inputs table row", row);

    const flag = bullet(readme, "- `--dependency-allowed-host");
    expectRules("the CLI flag bullet", flag);
    const cli = section(readme, "## CLI");
    expect(cli, "the CLI synopsis").toContain("[--dependency-allowed-host");

    const safety = section(readme, "## Dependency safety");
    expect(safety, "the Dependency safety section").toContain("dependencies.allowed_hosts");
    expectRules("the Dependency safety section", safety);
  });

  it("AC-14: schema/policy.v1.json describes dependencies.allowed_hosts with its tighten rule", () => {
    const schema = JSON.parse(read("schema/policy.v1.json")) as {
      properties?: { dependencies?: { properties?: { allowed_hosts?: { description?: string } } } };
    };
    const description = schema.properties?.dependencies?.properties?.allowed_hosts?.description ?? "";
    expect(description.length, "allowed_hosts has no description").toBeGreaterThan(0);
    expect(description, "the app policy replaces the input").toMatch(/replac/i);
    expect(description, "the app policy replaces the input").toMatch(/\binput\b/i);
    expect(description, "a policy file may not set it").toMatch(/\bfile\b[^.]*\b(?:not|never)\b/i);
  });
});
