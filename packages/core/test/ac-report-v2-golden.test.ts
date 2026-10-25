import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

const ROOT = new URL("../../../", import.meta.url);
const readRoot = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const FIXTURE_REPORTS = [
  "golden/report.json",
  "golden-cobertura/report.json",
  "golden-exclusions/report.json",
  "golden-multi/report.json",
  "coverage-paths/package-relative/report.json",
  "coverage-paths/package-relative/report-warn.json",
  "setup-expect/report-files-missing.json",
  "setup-expect/report-no-files-missing.json",
];

function v2Validator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  ajv.addSchema(JSON.parse(readRoot("schema/report.v1.json")));
  return ajv.compile(JSON.parse(readRoot("schema/report.v2.json")));
}

describe("golden and fixture reports are Report v2", () => {
  it("AC-5: every golden and fixture report passes the v2 schema, and the footer reads report schema v2", async () => {
    const validate = v2Validator();
    for (const path of FIXTURE_REPORTS) {
      const report = JSON.parse(fixture(path));
      expect(validate(report), `${path}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }

    const { check } = await import("../src/check.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    const subLines = renderMarkdown(report)
      .split("\n")
      .filter((line) => line.includes("<sub>"));
    const footer = subLines[subLines.length - 1] ?? "";
    expect(footer).toContain("report schema v2");
    expect(footer).not.toContain("report schema v1");
  });
});
