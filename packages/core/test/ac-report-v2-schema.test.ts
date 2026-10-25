import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

const ROOT = new URL("../../../", import.meta.url);
const readRoot = (path: string) => readFileSync(new URL(path, ROOT));

/** sha256 of schema/report.v1.json at commit 91b6270b6fbdac0bd09bc6fb4b950fb73958200a, before Report v2. */
const V1_SCHEMA_SHA256 = "c6cfd5b5afeada776fa89028f5ef29e06427d0e32529420184474e52ca77c731";

/** A strict 2020-12 validator for schema/report.v2.json, with v1 added so its $refs resolve. */
function v2Validator() {
  const v1 = JSON.parse(readRoot("schema/report.v1.json").toString("utf8"));
  const v2 = JSON.parse(readRoot("schema/report.v2.json").toString("utf8"));
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  ajv.addSchema(v1);
  return { v2, validate: ajv.compile(v2) };
}

async function goldenReport() {
  const { check } = await import("../src/check.js");
  return check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: 80,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
  }) as unknown as Record<string, unknown>;
}

describe("schema/report.v2.json", () => {
  it("AC-1: compiles under a strict 2020-12 validator with v1 added, and leaves report.v1.json byte-identical", () => {
    let compiled: ReturnType<typeof v2Validator> | undefined;
    expect(() => {
      compiled = v2Validator();
    }).not.toThrow();
    expect(compiled?.v2.$id).toBe("https://pharn.dev/schemas/ci/report.v2.json");
    const v1Digest = createHash("sha256").update(readRoot("schema/report.v1.json")).digest("hex");
    expect(v1Digest, "schema/report.v1.json is unchanged").toBe(V1_SCHEMA_SHA256);
  });

  it("AC-4: accepts check()'s v2 report and rejects a string or v1 schemaVersion, an unknown testIntegrity key and TI17", async () => {
    const { validate } = v2Validator();
    const report = await goldenReport();
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);

    const testIntegrity = report.testIntegrity as Record<string, unknown>;
    expect(validate({ ...report, schemaVersion: "2" }), 'schemaVersion "2"').toBe(false);
    expect(validate({ ...report, schemaVersion: "1" }), 'schemaVersion "1"').toBe(false);
    expect(validate({ ...report, testIntegrity: { ...testIntegrity, extra: true } }), "unknown key").toBe(false);
    expect(
      validate({
        ...report,
        testIntegrity: {
          ...testIntegrity,
          signals: [{ id: "TI17", severity: "warn", path: "a.test.ts", line: 1, detail: "x" }],
        },
      }),
      "signal id TI17",
    ).toBe(false);
  });
});
