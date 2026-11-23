import { describe, expect, it } from "vitest";
import type { PolicyResponseValidation as Validation } from "../src/policy/response.js";
import type { PolicyError } from "../src/policy/types.js";
import { fixture } from "./helpers.js";

// validatePolicyResponse() and the fixtures under fixtures/policy-response/ are loaded inside the test body: the AC
// test is written before the response validator exists, so nothing the build adds may run while the file loads.
// fixtures/policy-response/invalid.json maps a case name to an invalid envelope; the three large cases are built here
// from valid.json.

/** RFC 6901: "" or a sequence of `/`-prefixed reference tokens, `~` only as `~0` or `~1`. */
const POINTER = /^(\/([^~/]|~[01])*)*$/;

// CORE-118 (R5.1): a key the envelope (or its settings) does not know no longer voids it: a newer app may serve one to a
// pinned build. Those two cases of invalid.json are accepted with the key left out and named (SKIPPED_CASES below);
// every other case still fails as before.
const SKIPPED_CASES: Record<string, string> = {
  "unknown-key": "zzz-unknown",
  "settings-extra-key": "settings.zzz-extra",
};

// CORE-123 (R5.6): `etag`, `updatedAt` and `settings.redactMessages` are not read by the Action, so they are optional
// and not validated: these cases of invalid.json are accepted, with nothing named as unknown and the response holding
// only the keys the Action reads. Every other case still fails as before.
const UNREAD_CASES = [
  "etag-empty",
  "etag-201",
  "etag-e-acute",
  "etag-tab",
  "updatedAt-month-13",
  "updatedAt-no-z",
  "updatedAt-lower-t",
  "updatedAt-hour-24",
  "settings-missing-redact",
];

const SMALL_CASES = [
  "missing-key",
  "version-0",
  "version-1.5",
  "version-string",
  "policy-threshold",
  "quarantine-empty-item",
  "quarantine-u0085",
  "max-bytes-255",
  "max-bytes-65537",
  "max-bytes-300.5",
];

/** The envelope as the Action reads it: no `etag`, `updatedAt` or `settings.redactMessages`. */
function asRead(envelope: Record<string, unknown>): Record<string, unknown> {
  const { etag: _etag, updatedAt: _updatedAt, settings, ...rest } = envelope;
  const { redactMessages: _redact, ...used } = settings as Record<string, unknown>;
  return { ...rest, settings: used };
}

/** The leaf values and keys of `invalid` that differ from `valid`, as strings of at least three characters. */
function offendingValues(valid: unknown, invalid: unknown): string[] {
  const out: string[] = [];
  const walk = (a: unknown, b: unknown) => {
    if (b !== null && typeof b === "object" && !Array.isArray(b)) {
      const left = a !== null && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>) : {};
      for (const [key, value] of Object.entries(b as Record<string, unknown>)) {
        if (!(key in left)) out.push(key);
        walk(left[key], value);
      }
      return;
    }
    if (Array.isArray(b)) {
      const left = Array.isArray(a) ? a : [];
      for (const [i, value] of b.entries()) walk(left[i], value);
      return;
    }
    if ((typeof b === "string" || typeof b === "number") && a !== b) out.push(String(b));
  };
  walk(valid, invalid);
  return out.filter((s) => s.length >= 3);
}

function expectFixedErrors(result: Validation, name: string, offending: string[]): PolicyError[] {
  expect(result.ok, name).toBe(false);
  if (result.ok) return [];
  expect(result.errors.length, name).toBeGreaterThan(0);
  for (const error of result.errors) {
    expect(error.path, name).toMatch(POINTER);
    expect(typeof error.message, name).toBe("string");
    for (const value of offending) expect(error.message, `${name}: ${value}`).not.toContain(value);
  }
  return result.errors;
}

describe("the policy response envelope", () => {
  it("AC-13: validatePolicyResponse accepts the valid envelope and refuses each invalid one with RFC 6901 paths and fixed messages, capped at POLICY_MAX_ERRORS", async () => {
    const { validatePolicyResponse, POLICY_MAX_ERRORS } = {
      ...(await import("../src/policy/limits.js")),
      ...(await import("../src/policy/response.js")),
    };
    const valid = JSON.parse(fixture("policy-response/valid.json"));
    expect(Object.keys(valid).sort()).toEqual(["etag", "policy", "quarantine", "settings", "updatedAt", "version"]);

    const accepted = validatePolicyResponse(valid);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(Object.keys(accepted.response).sort()).toEqual(["policy", "quarantine", "settings", "version"]);
      expect(accepted.response).toEqual(asRead(valid));
    }

    const invalid = JSON.parse(fixture("policy-response/invalid.json")) as Record<string, unknown>;
    expect(Object.keys(invalid).sort()).toEqual(
      [...SMALL_CASES, ...UNREAD_CASES, ...Object.keys(SKIPPED_CASES)].sort(),
    );
    for (const [name, unknownName] of Object.entries(SKIPPED_CASES)) {
      const skipped = validatePolicyResponse(invalid[name]);
      expect(skipped.ok, name).toBe(true);
      if (skipped.ok) {
        expect(skipped.response, `${name}: the unknown key is left out`).toEqual(asRead(valid));
        expect(skipped.unknown, name).toEqual({ names: [unknownName], total: 1 });
      }
    }
    for (const name of UNREAD_CASES) {
      const unread = validatePolicyResponse(invalid[name]);
      expect(unread.ok, name).toBe(true);
      if (unread.ok) {
        expect(unread.response, `${name}: only the keys the Action reads`).toEqual(asRead(valid));
        expect(unread.unknown, name).toEqual({ names: [], total: 0 });
      }
    }
    for (const name of SMALL_CASES) {
      const errors = expectFixedErrors(
        validatePolicyResponse(invalid[name]),
        name,
        offendingValues(valid, invalid[name]),
      );
      if (name === "policy-threshold") {
        expect(
          errors.some((e) => e.path.startsWith("/policy/coverage/threshold")),
          JSON.stringify(errors),
        ).toBe(true);
      }
    }

    // The large cases, built from the valid envelope.
    const tooMany = { ...valid, quarantine: Array.from({ length: 10_001 }, (_, i) => `test-${i}`) };
    expectFixedErrors(validatePolicyResponse(tooMany), "quarantine of 10001 items", []);
    const longItem = "q".repeat(1025);
    expectFixedErrors(validatePolicyResponse({ ...valid, quarantine: [longItem] }), "a 1025-unit quarantine item", [
      longItem,
    ]);

    const manyProblems = {
      ...valid,
      quarantine: Array.from({ length: 80 }, () => ""),
      settings: { uploadJunit: "x", redactMessages: "y", messageMaxBytes: 1 },
      extra: true,
    };
    const capped = validatePolicyResponse(manyProblems);
    expect(capped.ok).toBe(false);
    if (!capped.ok) {
      expect(capped.errors.length).toBeGreaterThan(0);
      expect(capped.errors.length).toBeLessThanOrEqual(POLICY_MAX_ERRORS);
      expect(POLICY_MAX_ERRORS).toBe(50);
    }
  });
});
