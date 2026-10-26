import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

// The fixtures and the validator are read inside the test body: the build writes them, after this test.

const INVALID = `${FIXTURES}policy/invalid/`;

const REQUIRED = [
  "version-wrong",
  "version-missing",
  "unknown-top-key",
  "unknown-nested-key",
  "wrong-type",
  "out-of-range",
  "glob-grammar",
  "root-dotdot",
  "perm-grammar",
  "name-grammar",
  "label-grammar",
  "login-grammar",
  "hook-grammar",
  "control-char",
  "list-too-long",
  "unknown-ti",
  "unknown-p",
  "bad-enum",
];

describe("validatePolicy on fixtures/policy/invalid/", () => {
  it("AC-3: every invalid fixture is rejected with exactly its recorded error paths, in order, and the same list twice", async () => {
    const { validatePolicy } = await import("@pharn-ci/core");

    const files = readdirSync(INVALID).filter((name) => name.endsWith(".json"));
    for (const name of REQUIRED) expect(files, `fixture ${name}.json`).toContain(`${name}.json`);

    for (const file of files) {
      const name = file.slice(0, -".json".length);
      const value: unknown = JSON.parse(readFileSync(INVALID + file, "utf8"));
      const expected: unknown = JSON.parse(readFileSync(`${INVALID}${name}.paths`, "utf8"));

      const first = validatePolicy(value);
      expect(first.ok, name).toBe(false);
      if (first.ok) continue;
      expect(
        first.errors.map((e) => e.path),
        name,
      ).toEqual(expected);

      const second = validatePolicy(value);
      expect(second.ok, name).toBe(false);
      if (second.ok) continue;
      expect(second.errors, name).toEqual(first.errors);
    }
  });
});
