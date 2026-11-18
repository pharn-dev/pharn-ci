import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// fix-hints (H6), AC-13. Reads schema/report.v2.json; nothing the build adds is loaded. (CORE-133: the README,
// CHANGELOG and LIMITS wording checks moved out.)

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

describe("the schema of fix hints", () => {
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
