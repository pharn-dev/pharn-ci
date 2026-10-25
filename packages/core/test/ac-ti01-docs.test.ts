import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
/** The commit before this increment. */
const BEFORE = "b145a7f3e7ad2b8b13af7b591a3186128a355cc6";

const FIXTURES = [
  "block-code-stays.diff",
  "block-rename-away.diff",
  "block-root-tests.diff",
  "pass-helper.diff",
  "pass-init-py.diff",
  "pass-fixture-json.diff",
  "pass-binary.diff",
  "info-with-source.diff",
  "info-package-removed.diff",
  "info-migration-ts.diff",
  "info-migration-mjs.diff",
];

/** The text of one `## [..]` section of CHANGELOG.md, from the heading to the next one. */
function changelogSection(name: string): string {
  const parts = read("CHANGELOG.md").split(/^## \[/m);
  const section = parts.find((p) => p.startsWith(`${name}]`));
  if (section === undefined) throw new Error(`CHANGELOG.md has no ${name} section`);
  return section;
}

describe("TI01: docs, schema and fixtures", () => {
  it("AC-12: the v2 schema names TEST_INTEGRITY_TI01 and the v1 schema is byte-identical to the base commit's", () => {
    expect(read("schema/report.v2.json")).toContain("TEST_INTEGRITY_TI01");
    const before = execFileSync("git", ["show", `${BEFORE}:schema/report.v1.json`], {
      cwd: fileURLToPath(ROOT),
      encoding: "utf8",
    });
    expect(read("schema/report.v1.json")).toBe(before);
  });

  it("AC-12: the changelog, README, limits and threat model name TI01", () => {
    expect(changelogSection("Unreleased")).toContain("TI01");
    expect(read("README.md")).toContain("TI01");
    const limits = read("docs/LIMITS.md");
    expect(limits).toContain("TI01");
    expect(limits).toContain("5000");
    expect(read("docs/THREAT-MODEL.md")).toContain("TI01");
  });

  it.each(FIXTURES)("AC-12: fixtures/test-integrity/TI01/%s exists", (name) => {
    expect(existsSync(new URL(`fixtures/test-integrity/TI01/${name}`, ROOT))).toBe(true);
  });
});
