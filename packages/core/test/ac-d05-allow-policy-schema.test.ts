import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { validatePolicy } from "../src/policy/validate.js";

// d05-private-registry-allowlist, AC-13: the org policy gains the optional dependencies.allowed_hosts, an array of at
// most 50 host names. Both the hand-written validator and Ajv over schema/policy.v1.json accept a list of host names
// and refuse a URL, a non-string and 51 entries, with errors located under /dependencies/allowed_hosts whose messages
// repeat no value from the document.

const SCHEMA_URL = new URL("../../../schema/policy.v1.json", import.meta.url);

const doc = (allowed: unknown) => ({ version: 1, dependencies: { allowed_hosts: allowed } });
const MANY = Array.from({ length: 51 }, (_, i) => `h${i}.corp.example`);
const INVALID: ReadonlyArray<readonly [string, unknown, string[]]> = [
  ["a URL", ["https://x"], ["https://x"]],
  ["a number", [12345], ["12345"]],
  ["51 host names", MANY, ["corp.example"]],
];

type Failure = { path: string; message: string };

describe("dependencies.allowed_hosts in the org policy", () => {
  it("AC-13: validatePolicy accepts host names and refuses a URL, a non-string or 51 entries under /dependencies/allowed_hosts, repeating no value", () => {
    const valid = validatePolicy(doc(["npm.corp.example"])) as { ok: boolean; errors?: Failure[] };
    expect(valid.ok, JSON.stringify(valid.errors)).toBe(true);
    for (const [name, value, secrets] of INVALID) {
      const result = validatePolicy(doc(value)) as { ok: boolean; errors?: Failure[] };
      expect(result.ok, name).toBe(false);
      const errors = result.errors ?? [];
      expect(errors.length, name).toBeGreaterThan(0);
      for (const error of errors) {
        expect(error.path.startsWith("/dependencies/allowed_hosts"), `${name}: ${error.path}`).toBe(true);
        for (const secret of secrets) expect(error.message, name).not.toContain(secret);
      }
    }
  });

  it("AC-13: schema/policy.v1.json accepts host names and refuses a URL, a non-string or 51 entries under /dependencies/allowed_hosts, repeating no value", () => {
    const schema = JSON.parse(readFileSync(SCHEMA_URL, "utf8")) as object;
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
    expect(validate(doc(["npm.corp.example"])), JSON.stringify(validate.errors)).toBe(true);
    for (const [name, value, secrets] of INVALID) {
      expect(validate(doc(value)), name).toBe(false);
      const errors = validate.errors ?? [];
      expect(errors.length, name).toBeGreaterThan(0);
      for (const error of errors) {
        expect(error.instancePath.startsWith("/dependencies/allowed_hosts"), `${name}: ${error.instancePath}`).toBe(
          true,
        );
        for (const secret of secrets) expect(error.message ?? "", name).not.toContain(secret);
      }
    }
  });
});
