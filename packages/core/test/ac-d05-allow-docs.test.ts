import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// d05-private-registry-allowlist, AC-14: schema/policy.v1.json describes dependencies.allowed_hosts with its tighten
// rule. (CORE-133: the README wording checks moved out; docs-contract.test.ts checks the README input row.)

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

describe("the allowed hosts in the policy schema", () => {
  it("AC-14: schema/policy.v1.json describes dependencies.allowed_hosts with its tighten rule", () => {
    const schema = JSON.parse(read("schema/policy.v1.json")) as {
      properties?: { dependencies?: { properties?: { allowed_hosts?: { description?: string } } } };
    };
    const description = schema.properties?.dependencies?.properties?.allowed_hosts?.description ?? "";
    expect(description.length, "allowed_hosts has no description").toBeGreaterThan(0);
    expect(description, "the app policy replaces the input").toMatch(/replac/i);
    expect(description, "the app policy replaces the input").toMatch(/\binput\b/i);
    expect(description, "a policy file may not set it").toMatch(/\bfile\b[^.]*\b(?:not|never)\b/i);
  });
});
