import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { V080_CODE_TEXT, V080_FLAKY_CODES, V080_FLAKY_SCHEMA_TEXT, V080_FLAKY_TEXT } from "./v080-codes.js";

// Flaky tests (A6): the schema names the four codes and describes `flaky` exactly once, and the README, LIMITS,
// THREAT-MODEL, SECURITY, CHANGELOG and action.yml say what the feature does and misses.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

describe("flaky tests: schema and documents", () => {
  it("report.v2.json carries the v0.8.0 code text and the flaky description once, and report.ts the codes", () => {
    const schema = read("schema/report.v2.json");
    expect(schema.split(V080_FLAKY_SCHEMA_TEXT)).toHaveLength(2);
    expect(schema.split(V080_CODE_TEXT)).toHaveLength(2);
    expect(V080_CODE_TEXT).toContain(V080_FLAKY_TEXT);
    const report = read("packages/core/src/report.ts");
    for (const code of V080_FLAKY_CODES) {
      expect(V080_FLAKY_TEXT, code).toContain(code);
      expect(report, code).toContain(`| "${code}"`);
    }
  });

  it("the README has the section, the input row, the CLI flags and a row per code", () => {
    const readme = read("README.md");
    expect(readme).toContain("## Flaky tests and JUnit results");
    expect(readme).toContain("| `junit-paths`");
    expect(readme).toContain("pharn-ci test [--junit <file|glob>]...");
    expect(readme).toContain("**Test id.** A test is named `<classname>::<name>`.");
    for (const code of V080_FLAKY_CODES) expect(readme, code).toContain(`| \`${code}\` |`);
  });

  it("LIMITS, THREAT-MODEL, SECURITY, CHANGELOG and action.yml describe the read, the upload and the wrapper", () => {
    const limits = read("docs/LIMITS.md");
    expect(limits).toContain("## Flaky tests and JUnit results");
    expect(limits).toContain("**The CLI wrapper.**");
    const threat = read("docs/THREAT-MODEL.md");
    expect(threat).toMatch(/^\| A9 {2}\| JUnit XML the test step writes/m);
    expect(threat).toContain(
      "42. **pharn-ci trusts the JUnit files, and `pharn-ci test` trusts its quarantine file.**",
    );
    expect(threat).toContain("`junit/results.xml`");
    expect(read("SECURITY.md")).toContain("| JUnit XML the test step wrote (`junit-paths`; CLI `--junit`) |");
    const unreleased = read("CHANGELOG.md").split("## [Unreleased]")[1]?.split("\n## [")[0] ?? "";
    expect(unreleased).toContain("Flaky tests (A6)");
    expect(read("action.yml")).toMatch(/^ {2}junit-paths:$/m);
  });
});
