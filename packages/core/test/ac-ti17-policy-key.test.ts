import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

// ti17-always-true-matcher-2, AC-16. The validator, schema/policy.v1.json and the unknown-ti fixture are read inside
// the test body: the build changes all three after this test is written.

const ID = ["TI", "17"].join("");
const NEXT = ["TI", "18"].join("");
const SCHEMA_URL = new URL("../../../schema/policy.v1.json", import.meta.url);

const doc = (key: string) => ({ version: 1, test_integrity: { signals: { [key]: "warn" } } });

describe("the TI17 key of an org policy", () => {
  it("AC-16: a policy with test_integrity.signals.TI17 is valid for core and the schema, one with TI18 is invalid with an error at its path that repeats no value, and the unknown-ti fixture names TI18", async () => {
    const { validatePolicy } = (await import("../src/policy/validate.js")) as unknown as {
      validatePolicy(value: unknown): { ok: boolean; errors?: Array<{ path: string; message: string }> };
    };
    const ajv = new Ajv2020({ strict: true, allErrors: true }).compile(
      JSON.parse(readFileSync(SCHEMA_URL, "utf8")) as object,
    );

    const valid = validatePolicy(doc(ID));
    expect(valid.ok, `core: ${JSON.stringify(valid.errors)}`).toBe(true);
    expect(ajv(doc(ID)), `schema: ${JSON.stringify(ajv.errors)}`).toBe(true);

    const invalid = validatePolicy(doc(NEXT));
    expect(invalid.ok).toBe(false);
    const errors = invalid.errors ?? [];
    const atKey = errors.filter((e) => e.path === `/test_integrity/signals/${NEXT}`);
    expect(atKey, "an error at the TI18 path").toHaveLength(1);
    for (const error of errors) expect(error.message, "no document value in a message").not.toContain("warn");
    expect(ajv(doc(NEXT)), "the schema rejects TI18").toBe(false);

    const unknown = readFileSync(`${FIXTURES}policy/invalid/unknown-ti.json`, "utf8");
    const keys = Object.keys(
      (JSON.parse(unknown) as { test_integrity: { signals: Record<string, unknown> } }).test_integrity.signals,
    );
    expect(keys, "the fixture's unknown key").toContain(NEXT);
    expect(keys, "the fixture no longer uses TI17").not.toContain(ID);
    const paths = JSON.parse(readFileSync(`${FIXTURES}policy/invalid/unknown-ti.paths`, "utf8")) as string[];
    expect(paths).toContain(`/test_integrity/signals/${NEXT}`);
    expect(paths).not.toContain(`/test_integrity/signals/${ID}`);
  });
});
