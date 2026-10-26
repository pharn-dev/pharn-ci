import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

// The fixtures and the validator are read inside the test body: the build writes them, after this test.

const VALID = `${FIXTURES}policy/valid/`;

const REQUIRED = [
  "full-example.json",
  "minimal.json",
  "coverage.json",
  "setup.json",
  "test-integrity.json",
  "flaky.json",
  "policy.json",
  "agents.json",
  "dependencies.json",
  "empty-sections.json",
  "boundaries-min.json",
  "boundaries-max.json",
];

const SECTIONS = ["coverage", "setup", "test_integrity", "flaky", "policy", "agents", "dependencies"];

describe("validatePolicy and parsePolicyJson on fixtures/policy/valid/", () => {
  it("AC-2: every valid fixture is accepted by both, with a deep-equal policy in fresh objects", async () => {
    const { validatePolicy, parsePolicyJson } = await import("@pharn-ci/core");

    const files = readdirSync(VALID).filter((name) => name.endsWith(".json"));
    for (const name of REQUIRED) expect(files, `fixture ${name}`).toContain(name);

    for (const name of files) {
      const text = readFileSync(VALID + name, "utf8");
      const input = JSON.parse(text) as Record<string, unknown>;

      const validated = validatePolicy(input);
      expect(validated.ok, `validatePolicy ${name}`).toBe(true);
      if (!validated.ok) continue;
      expect(validated.policy, `validatePolicy ${name}`).toEqual(JSON.parse(text));
      expect(validated.policy).not.toBe(input);
      const output = validated.policy as unknown as Record<string, unknown>;
      for (const section of SECTIONS) {
        if (!Object.hasOwn(output, section)) continue;
        expect(output[section], `${name} ${section}`).not.toBe(input[section]);
      }

      const parsed = parsePolicyJson(text);
      expect(parsed.ok, `parsePolicyJson ${name}`).toBe(true);
      if (parsed.ok) expect(parsed.policy, `parsePolicyJson ${name}`).toEqual(JSON.parse(text));
    }
  });
});
