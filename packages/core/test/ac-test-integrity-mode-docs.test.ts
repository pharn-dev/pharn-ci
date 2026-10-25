import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
/** The commit before this increment. */
const BEFORE = "e39cda3780c7df9c14c84018d187c2c9adfc7f9a";

/** The text of one `## [..]` section of CHANGELOG.md, from the heading to the next one. */
function changelogSection(name: string): string {
  const parts = read("CHANGELOG.md").split(/^## \[/m);
  const section = parts.find((p) => p.startsWith(`${name}]`));
  if (section === undefined) throw new Error(`CHANGELOG.md has no ${name} section`);
  return section;
}

/** The text of one input of action.yml: from its key to the next key at the same indent. */
function actionInput(name: string): string {
  const lines = read("action.yml").split("\n");
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) throw new Error(`action.yml declares no input ${name}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^ {0,2}\S/.test(l));
  return rest.slice(0, end === -1 ? undefined : end).join("\n");
}

describe("test-integrity mode: docs and schema", () => {
  it("AC-11: action.yml declares the test-integrity input and says what it takes and that the config can only tighten", () => {
    const input = actionInput("test-integrity");
    for (const word of ["block", "warn", "off", ".pharn/ci.yml"]) expect(input).toContain(word);
  });

  it("AC-11: the changelog, README and threat model name the input, the config key and the tighten-only rule", () => {
    // Shipped in 0.2.0; before that release its line sat under Unreleased.
    const shipped = changelogSection("0.2.0");
    expect(shipped).toContain("test-integrity");
    expect(shipped).toContain("test_integrity.mode");

    const readme = read("README.md");
    for (const word of ["test-integrity", "--test-integrity", "test_integrity"]) expect(readme).toContain(word);

    expect(read("docs/THREAT-MODEL.md")).toContain("test_integrity.mode");
  });

  it("AC-11: report.v2.json lists both new codes and report.v1.json is byte-identical to the base commit's", () => {
    const v2 = read("schema/report.v2.json");
    expect(v2).toContain("TEST_INTEGRITY_MODE_IGNORED");
    expect(v2).toContain("TEST_INTEGRITY_OFF");

    const before = execFileSync("git", ["show", `${BEFORE}:schema/report.v1.json`], {
      cwd: fileURLToPath(ROOT),
      encoding: "utf8",
    });
    expect(read("schema/report.v1.json")).toBe(before);
  });
});
