import { describe, expect, it } from "vitest";
import { validatePolicyResponse } from "../src/index.js";
import { fixture } from "./helpers.js";

// CORE-123 (R5.6): the Action reads `version`, `policy`, `quarantine`, `settings.uploadJunit` and
// `settings.messageMaxBytes` of the policy envelope, and nothing else. `etag`, `updatedAt` and `settings.redactMessages`
// are optional and skipped unread; their absence, or any value they hold, gives the same validated response, so it can
// loosen nothing. The inputs start from fixtures/policy-response/valid.json and CORE-118's
// fixtures/policy-api/newer/updated-at-offset.json.

type Envelope = Record<string, unknown> & { settings: Record<string, unknown> };
const valid = (): Envelope => JSON.parse(fixture("policy-response/valid.json")) as Envelope;

function accepted(value: unknown) {
  const result = validatePolicyResponse(value);
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.errors)}`);
  return result;
}

describe("the policy envelope's unread keys are optional (CORE-123)", () => {
  it("accepts an envelope without etag, updatedAt or settings.redactMessages, with the same response as the full one", () => {
    const full = accepted(valid());
    const bare = valid();
    delete bare.etag;
    delete bare.updatedAt;
    delete bare.settings.redactMessages;
    const result = accepted(bare);
    expect(result.response).toEqual(full.response);
    expect(result.unknown).toEqual({ names: [], total: 0 });
    expect(Object.keys(result.response).sort()).toEqual(["policy", "quarantine", "settings", "version"]);
    expect(result.response.settings).toEqual({ uploadJunit: false, messageMaxBytes: 4096 });
  });

  it("skips any value of the unread keys without naming it, and never copies it", () => {
    const full = accepted(valid());
    for (const value of [7, null, true, "", "x".repeat(10_000), { nested: ["a"] }, ["2026"], "line\nbreak"]) {
      const envelope = valid();
      envelope.etag = value;
      envelope.updatedAt = value;
      envelope.settings.redactMessages = value;
      const result = accepted(envelope);
      expect(result.response, JSON.stringify(value)).toEqual(full.response);
      expect(result.unknown, JSON.stringify(value)).toEqual({ names: [], total: 0 });
      expect(JSON.stringify(result.response)).not.toContain("etag");
      expect(JSON.stringify(result.response)).not.toContain("redactMessages");
    }
  });

  it("still requires every key the Action reads", () => {
    for (const drop of ["version", "policy", "quarantine", "settings"]) {
      const envelope = valid();
      delete envelope[drop];
      const result = validatePolicyResponse(envelope);
      expect(result.ok, drop).toBe(false);
      if (!result.ok) expect(result.errors).toContainEqual({ path: `/${drop}`, message: expect.any(String) });
    }
    for (const drop of ["uploadJunit", "messageMaxBytes"]) {
      const envelope = valid();
      delete envelope.settings[drop];
      const result = validatePolicyResponse(envelope);
      expect(result.ok, drop).toBe(false);
      if (!result.ok) expect(result.errors).toContainEqual({ path: `/settings/${drop}`, message: expect.any(String) });
    }
  });

  it("still accepts CORE-118's updatedAt with a +00:00 offset", () => {
    const result = accepted(JSON.parse(fixture("policy-api/newer/updated-at-offset.json")));
    expect(result.unknown).toEqual({ names: [], total: 0 });
    expect(result.response.version).toBe(7);
  });
});
