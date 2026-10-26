import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// E3 item 22 (policy rules), AC-18. Reads the repository's docs, schema and sources as text, and the schema at the
// base commit with git; nothing the build adds is loaded. The base is c8fdc65 (E3 item 21, which appended
// UPLOAD_TOO_LARGE to the same sentence): this change was rebased onto it from f563d7d.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "c8fdc65";
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const atCommit = (commit: string, path: string) =>
  execFileSync("git", ["show", `${commit}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const APPENDED =
  " POLICY_P08 (error, or the level the org policy sets for P08: tracked files match a forbidden file pattern of the org policy; the message names up to 20 paths and the count) and POLICY_P09 (error, or warn for an agent settings file whose direction is not judged yet: the change edits a file the org policy guards; the message names up to 20 paths and the count; each reason is in policy.violations).";

const REPINNED = [
  "packages/core/test/ac-policy3-unchanged.test.ts",
  "packages/action/test/ac-policy3-outcomes.test.ts",
  "packages/action/test/ac-policy3-other-keys.test.ts",
  "packages/cli/test/ac-policy3-file-mode.test.ts",
  "packages/core/test/ac-precision-v030-schema.test.ts",
  "packages/action/test/ac-pyparity2-unchanged.test.ts",
  "packages/core/test/ac-secrets-repin.test.ts",
];

/** The upper-case code words of a text (as the pyparity2 pin collects them). */
const words = (text: string) =>
  [...new Set([...text.matchAll(/\b(?:TI\d\d|[A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/g)].map((m) => m[0]))].sort();

const codeDescription = (schemaText: string): string =>
  (JSON.parse(schemaText) as { $defs: { message: { properties: { code: { description: string } } } } }).$defs.message
    .properties.code.description;

/** The text of a `## <title>` section, up to the next `## ` heading. */
function section(text: string, title: string): string {
  const lines = text.split("\n");
  const at = lines.indexOf(`## ${title}`);
  expect(at, title).toBeGreaterThanOrEqual(0);
  const next = lines.findIndex((l, i) => i > at && l.startsWith("## "));
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

describe("docs, schema and sources for the policy rules", { timeout: 60_000 }, () => {
  it("AC-18: the schema appends exactly the two codes, report.ts, the hints, README, LIMITS and CHANGELOG name them, and each re-pinned test names E3 item 22", () => {
    // Schema: the message-code description is the base one with exactly the appended text.
    const base = codeDescription(atCommit(BASE, "schema/report.v2.json"));
    const now = codeDescription(read("schema/report.v2.json"));
    expect(base.endsWith("the check ran in full).")).toBe(true);
    expect(now.startsWith(base)).toBe(true);
    expect(now.slice(base.length)).toBe(APPENDED);
    expect(words(now.slice(base.length))).toEqual(["POLICY_P08", "POLICY_P09"]);

    // report.ts MessageCode and the renderer's hints.
    const report = read("packages/core/src/report.ts");
    const messageCode = /export type MessageCode =([\s\S]*?);/.exec(report)?.[1] ?? "";
    expect(messageCode).toContain('"POLICY_P08"');
    expect(messageCode).toContain('"POLICY_P09"');
    const markdown = read("packages/core/src/render/markdown.ts");
    expect(markdown).toContain("MESSAGE_HINTS");
    expect(markdown).toMatch(/^\s*POLICY_P08:\s*["'`]Stop tracking the file /m);
    expect(markdown).toMatch(/^\s*POLICY_P09:\s*["'`]Revert the edit, or ask the policy owner to make it/m);

    // README: two code-table rows and the four rules in the Org policy section.
    const readme = read("README.md");
    expect(readme).toMatch(/^\| `POLICY_P08` +\|/m);
    expect(readme).toMatch(/^\| `POLICY_P09` +\|/m);
    const orgPolicy = section(readme, "Org policy");
    for (const id of ["P01", "P08", "P09", "P10"]) expect(orgPolicy, id).toContain(id);

    // LIMITS: what P09 sees and what it misses.
    const limits = section(read("docs/LIMITS.md"), "Org policy");
    for (const term of ["P09", "policy: never", "app-url", ".github/workflows/", "CONFIG_CHANGED_IN_DIFF"]) {
      expect(limits, term).toContain(term);
    }

    // CHANGELOG: exactly one Unreleased bullet names the codes, both of them, and not OIDC.
    const changelog = read("CHANGELOG.md");
    const start = changelog.indexOf("## [Unreleased]");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = changelog.indexOf("\n## [", start + 1);
    const unreleased = changelog.slice(start, end === -1 ? undefined : end);
    const naming = bullets(unreleased).filter((b) => b.includes("POLICY_P08") || b.includes("POLICY_P09"));
    expect(naming).toHaveLength(1);
    expect(naming[0]).toContain("POLICY_P08");
    expect(naming[0]).toContain("POLICY_P09");
    expect(naming[0]).not.toContain("OIDC");

    // Each deliberate re-pin carries the comment naming this item.
    for (const path of REPINNED) {
      const lines = read(path).split("\n");
      expect(
        lines.some((l) => /^\s*(\/\/|\/\*|\*)/.test(l) && l.includes("E3 item 22 (policy rules)")),
        path,
      ).toBe(true);
    }
  });
});
