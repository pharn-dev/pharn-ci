import { readdirSync, readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

// The schema, the fixtures and the validator are read inside the test body: the build writes them, after this test.

const ROOT = new URL("../../../", import.meta.url);
const DIRS = [`${FIXTURES}policy/valid/`, `${FIXTURES}policy/invalid/`];

describe("schema/policy.v1.json and validatePolicy agree", () => {
  it("AC-4: Ajv2020 and validatePolicy give the same accept or reject verdict on every policy fixture", async () => {
    const schema: unknown = JSON.parse(readFileSync(new URL("schema/policy.v1.json", ROOT), "utf8"));
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema as object);
    const { validatePolicy } = await import("@pharn-ci/core");

    let checked = 0;
    for (const dir of DIRS) {
      for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
        const value: unknown = JSON.parse(readFileSync(dir + file, "utf8"));
        const ajv = validate(value) === true;
        expect(validatePolicy(value).ok, `${dir}${file}`).toBe(ajv);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(40);
  });
});
