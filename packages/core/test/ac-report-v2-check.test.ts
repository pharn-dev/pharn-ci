import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

const ROOT = new URL("../../../", import.meta.url);
const readRoot = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/**
 * sha256 of the key-sorted JSON of { verdict, diffCoverage, agentSetup, messages } from fixtures/golden/report.json
 * at commit 91b6270b6fbdac0bd09bc6fb4b950fb73958200a: the v1 golden report for the same inputs (verdict "fail",
 * messages DIFF_COVERAGE_BELOW_THRESHOLD and COVERAGE_PATHS_PARTIALLY_UNMATCHED).
 */
const V1_GOLDEN_FIELDS_SHA256 = "9750dd1c7b764e30d39f3fbb70d3fffebaf7ef0e591fc640a79b312b5598d7b8";

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

function v2Validator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  ajv.addSchema(JSON.parse(readRoot("schema/report.v1.json")));
  return ajv.compile(JSON.parse(readRoot("schema/report.v2.json")));
}

const META = {
  event: "pull_request",
  repository: "pharn-dev/pharn-ci",
  repositoryId: 123,
  prNumber: 68,
  headSha: "b".repeat(40),
  baseSha: "a".repeat(40),
  scope: "ci/check",
  runId: 9,
  runAttempt: 1,
  actor: "octocat",
  upload: { status: "skipped" },
};

async function goldenReport(extra: Record<string, unknown> = {}) {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: 80,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    ...extra,
  };
  return check(input as Parameters<typeof check>[0]) as unknown as Record<string, unknown>;
}

describe("check() emits Report v2", () => {
  it("AC-2: schemaVersion 2, the empty testIntegrity block, no meta, and the v1 fields unchanged", async () => {
    const report = await goldenReport();
    expect(report.schemaVersion).toBe(2);
    expect(report.testIntegrity).toEqual({
      mode: "warn",
      source: "default",
      verdict: "pass",
      signals: [],
      languages: [],
    });
    expect("meta" in report).toBe(false);
    const v1Fields = {
      verdict: report.verdict,
      diffCoverage: report.diffCoverage,
      agentSetup: report.agentSetup,
      messages: report.messages,
    };
    expect(createHash("sha256").update(canonical(v1Fields)).digest("hex")).toBe(V1_GOLDEN_FIELDS_SHA256);
  });

  it("AC-3: carries a given meta object into the report unchanged, and the report is valid v2", async () => {
    const report = await goldenReport({ meta: META });
    expect(report.meta).toEqual(META);
    const validate = v2Validator();
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
  });
});
