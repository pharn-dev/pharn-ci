import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// fix-hints (H6), AC-13. Reads README.md, CHANGELOG.md, docs/LIMITS.md and schema/report.v2.json; nothing the build
// adds is loaded.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const KINDS = [
  "add-test",
  "restore-test",
  "restore-assertion",
  "revert-config",
  "remove-dependency",
  "request-review",
  "split-pr",
  "none",
];

/** The Markdown section under the first heading matching `heading`, up to the next heading of the same or a higher level. */
function section(text: string, heading: RegExp): string {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^#{1,6} /.test(l) && heading.test(l));
  expect(at, `a heading matching ${heading}`).toBeGreaterThanOrEqual(0);
  const level = /^(#+)/.exec(lines[at] ?? "")?.[1]?.length ?? 1;
  const end = lines.findIndex((l, i) => i > at && new RegExp(`^#{1,${level}} `).test(l));
  return lines.slice(at + 1, end === -1 ? lines.length : end).join("\n");
}

describe("documentation of fix hints", () => {
  it('AC-13: the README has a section headed "Fix hints" that lists the eight kinds, says what an agent may do with a hint and states that no hint lowers a gate', () => {
    const text = section(read("README.md"), /^#{1,6} Fix hints\s*$/);
    for (const kind of KINDS) expect(text, `the README section names \`${kind}\``).toContain(`\`${kind}\``);
    expect(text, "it says what an agent may do").toMatch(/agent/i);
    expect(text, "it names fix.kind").toContain("fix.kind");
    expect(text, "it states that no hint lowers a gate").toMatch(/\b(?:no|never)\b[^.]*\blowers? a gate\b/i);
  });

  it("AC-13: the CHANGELOG Unreleased section names the fix object", () => {
    const text = section(read("CHANGELOG.md"), /^## \[?Unreleased\]?/i);
    expect(text).toMatch(/`fix`/);
  });

  it("AC-13: docs/LIMITS.md has a section on fix hints saying they are generic, per code or id, and never prove that the fix was made or was right", () => {
    const text = section(read("docs/LIMITS.md"), /fix hints/i);
    expect(text, "generic").toMatch(/\bgeneric\b/i);
    expect(text, "per code or id").toMatch(/\bcode\b/i);
    expect(text, "per code or id").toMatch(/\b(?:signal )?id\b/i);
    expect(text, "never prove").toMatch(/\bnever prove/i);
  });

  it("AC-13: the schema's descriptions of fix, kind, target and hint say what each holds and never holds", () => {
    const schema = JSON.parse(read("schema/report.v2.json")) as {
      $defs: Record<string, { description?: string; properties?: Record<string, { description?: string }> }>;
    };
    const fix = schema.$defs.fix;
    expect(fix, "schema/report.v2.json has $defs.fix").toBeDefined();
    expect(fix?.description ?? "", "fix").toMatch(/lowers? a gate/i);
    const kind = fix?.properties?.kind?.description ?? "";
    for (const k of KINDS) expect(kind, `kind names ${k}`).toContain(k);
    const target = fix?.properties?.target?.description ?? "";
    expect(target, "target holds a path").toMatch(/path/i);
    expect(target, "target says what it never holds").toMatch(/\bnever\b/i);
    const hint = fix?.properties?.hint?.description ?? "";
    expect(hint, "hint is at most 200 characters").toContain("200");
    expect(hint, "hint says what it never holds").toMatch(/\bnever\b/i);
  });
});
