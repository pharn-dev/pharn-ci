import { describe, expect, it } from "vitest";
import { check, type ResolvedPolicy, renderMarkdown, validatePolicyResponse } from "../src/index.js";
import { policyKeysUnknownMessage } from "../src/policy/messages.js";
import { validatePolicy } from "../src/policy/validate.js";
import { hasUnsafeChar } from "../src/text.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-118 (R5.1): keys and ids a newer app serves are skipped and named, the rest of the policy applies. The inputs
// start from fixtures/policy-api/newer/baseline.json (an envelope with nothing unknown in it); the hostile keys are added
// here, since a control character or a 300-character key is clearer written as code than as JSON text.

type Envelope = { updatedAt: string; policy: Record<string, unknown> } & Record<string, unknown>;
const baseline = (): Envelope => JSON.parse(fixture("policy-api/newer/baseline.json")) as Envelope;

function accepted(value: unknown) {
  const result = validatePolicyResponse(value);
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.errors)}`);
  return result;
}

/** The code spans of a message text, in order. */
const spans = (text: string) => [...text.matchAll(/`([^`]*)`/g)].map((m) => m[1] ?? "");

describe("validatePolicyResponse skips what it does not know (CORE-118)", () => {
  it("names nothing for the baseline, and leaves its document as served", () => {
    const result = accepted(baseline());
    expect(result.unknown).toEqual({ names: [], total: 0 });
    expect(result.response.policy).toEqual(baseline().policy);
  });

  it("skips an unknown key at every depth and keeps every known sibling", () => {
    const envelope = baseline();
    envelope.lastEditor = "someone";
    (envelope.settings as Record<string, unknown>).uploadLogs = true;
    const policy = envelope.policy as Record<string, Record<string, unknown>>;
    policy.future_block = { anything: [1, 2, 3] };
    (policy.coverage as Record<string, unknown>).branches = 90;
    (policy.test_integrity?.signals as Record<string, unknown>).TI18 = "block";
    (policy.policy?.rules as Record<string, unknown>).P15 = "warn";
    policy.setup = {
      expect: ["codex", "devin", "codex-next"],
      required_hooks: [{ event: "PreToolUse", matcher: "Bash", command: "audit" }],
    };
    const result = accepted(envelope);
    expect(result.unknown).toEqual({
      names: [
        "lastEditor",
        "policy.coverage.branches",
        "policy.future_block",
        "policy.policy.rules.P15",
        "policy.setup.expect[codex-next]",
        "policy.setup.expect[devin]",
        "policy.setup.required_hooks[].command",
        "policy.test_integrity.signals.TI18",
        "settings.uploadLogs",
      ],
      total: 9,
    });
    const document = result.response.policy;
    expect(document.coverage).toEqual({ threshold: 85, exclude: ["gen/**"] });
    expect(document.test_integrity).toEqual({ mode: "block", signals: { TI01: "block" } });
    expect(document.policy).toEqual({ rules: { P11: "block" } });
    expect(document.agents).toEqual({ labels: ["agent-pr"], protected_paths: ["src/**"] });
    // An unknown tool leaves the list, never the whole list; a required hook with an unknown key stays required.
    expect(document.setup).toEqual({ expect: ["codex"], required_hooks: [{ event: "PreToolUse", matcher: "Bash" }] });
    expect(Object.hasOwn(document, "future_block")).toBe(false);
    // CORE-123: settings.redactMessages is not read, so it is not in the validated settings.
    expect(result.response.settings).toEqual({ uploadJunit: false, messageMaxBytes: 4096 });
  });

  it("still voids the response for a known key with a bad value, unknown keys or not", () => {
    for (const mutate of [
      (e: Envelope) => {
        (e.policy.coverage as Record<string, unknown>).threshold = "85";
      },
      (e: Envelope) => {
        (e.policy.test_integrity as Record<string, unknown>).mode = "strict";
      },
      (e: Envelope) => {
        (e.policy.setup as Record<string, unknown>).expect = ["codex", 7];
      },
      (e: Envelope) => {
        (e.policy.setup as Record<string, unknown>).expect = ["codex", ""];
      },
      (e: Envelope) => {
        e.policy.version = 2;
      },
      (e: Envelope) => {
        e.quarantine = "none";
      },
    ]) {
      const envelope = baseline();
      envelope.newKey = true;
      mutate(envelope);
      const result = validatePolicyResponse(envelope);
      expect(result.ok, JSON.stringify(envelope.policy)).toBe(false);
    }
  });

  // CORE-123 (R5.6): updatedAt is not read, so it is no longer checked as an RFC 3339 time. Every value, an offset out of
  // range included, is skipped unread and names nothing; the CORE-118 offset forms are still accepted.
  it("accepts updatedAt with Z or a numeric offset, and skips any other value unread", () => {
    for (const time of [
      "2026-10-26T10:00:00Z",
      "2026-10-26T10:00:00+00:00",
      "2026-10-26T10:00:00.5-05:30",
      "2026-10-26T10:00:00",
      "2026-10-26T10:00:00+24:00",
      "2026-10-26T10:00:00+05:60",
      "2026-10-26T10:00:00+0000",
      "2026-10-26t10:00:00Z",
    ]) {
      const envelope = baseline();
      envelope.updatedAt = time;
      const result = validatePolicyResponse(envelope);
      expect(result.ok, time).toBe(true);
      if (result.ok) {
        expect(result.unknown, time).toEqual({ names: [], total: 0 });
        expect(Object.hasOwn(result.response, "updatedAt"), time).toBe(false);
      }
    }
  });

  it("keeps 20 names, sorted by code unit, counts the rest, and cuts each to 64 code units", () => {
    const envelope = baseline();
    const signals = (envelope.policy.test_integrity as Record<string, Record<string, unknown>>).signals as Record<
      string,
      unknown
    >;
    for (let i = 0; i < 30; i++) signals[`TI${String(99 - i)}`] = "block";
    signals["x".repeat(300)] = "block";
    const result = accepted(envelope);
    expect(result.unknown.total).toBe(31);
    expect(result.unknown.names).toHaveLength(20);
    expect([...result.unknown.names].sort()).toEqual(result.unknown.names);
    expect(result.unknown.names[0]).toBe("policy.test_integrity.signals.TI70");
    for (const name of result.unknown.names) expect(name.length).toBeLessThanOrEqual(64);
    const cut = accepted({ ...baseline(), ["y".repeat(300)]: 1 }).unknown.names[0] ?? "";
    expect(cut).toHaveLength(64);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("validatePolicy (a file: policy) still refuses every unknown key and tool", () => {
    const document = JSON.parse(fixture("policy-api/newer/file-policy-ti18.json")) as unknown;
    const result = validatePolicy(document);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([{ path: "/test_integrity/signals/TI18", message: "is not a known key" }]);
    }
    expect(validatePolicy({ version: 1, setup: { expect: ["codex", "devin"] } }).ok).toBe(false);
  });
});

describe("the POLICY_KEYS_UNKNOWN message (CORE-118)", () => {
  it("names the keys as code spans, sorted, at most 20, and treats them as untrusted text", () => {
    const hostile = [
      "b`) [click](https://evil.example) `",
      `a\u0000${String.fromCharCode(0x202e)}hidden\nline`,
      "@octocat <script>",
      `${"z".repeat(100)}`,
    ];
    const message = policyKeysUnknownMessage({ names: hostile, total: 4 });
    expect(message.level).toBe("warn");
    expect(message.code).toBe("POLICY_KEYS_UNKNOWN");
    expect(hasUnsafeChar(message.text), "no control, invisible or bidirectional character").toBe(false);
    expect(message.text).toContain("�");
    const named = spans(message.text);
    expect(named).toHaveLength(4);
    expect([...named].sort()).toEqual(named);
    for (const name of named) expect(name.length).toBeLessThanOrEqual(64);
    expect(named).toContain("b') [click](https://evil.example) '");

    const many = Array.from({ length: 25 }, (_, i) => `k${String(i).padStart(2, "0")}`);
    const capped = policyKeysUnknownMessage({ names: many.slice(0, 20), total: 25 });
    expect(spans(capped.text)).toEqual(many.slice(0, 20));
    expect(capped.text).toContain(", and 5 more.");
  });

  it("is one warning in a report of an app policy, valid against the schema, and rendered without live markdown", () => {
    const envelope = baseline();
    envelope["@octocat <img src=x>"] = 1;
    (envelope.policy.test_integrity as Record<string, Record<string, unknown>>).signals = {
      TI01: "block",
      TI18: "block",
    };
    const result = accepted(envelope);
    const policy: ResolvedPolicy = {
      source: "app",
      version: result.response.version,
      fetchedAt: "2026-10-26T12:00:00.000Z",
      document: result.response.policy,
      unknownKeys: result.unknown,
    };
    const input = {
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" as const },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
      policy,
    };
    const report = check(input as never);
    expectValidReport(report);
    const messages = report.messages.filter((m) => m.code === "POLICY_KEYS_UNKNOWN");
    expect(messages).toHaveLength(1);
    expect(spans(messages[0]?.text ?? "")).toEqual(["@octocat <img src=x>", "policy.test_integrity.signals.TI18"]);
    expect(messages[0]?.fix?.kind).toBe("none");
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("POLICY_KEYS_UNKNOWN");
    expect(markdown).not.toContain("<img src=x");
    expect(markdown).toContain("&lt;img src=x&gt;");
    expect(markdown).not.toContain("@octocat ");

    // A file policy never carries skipped keys; even if a caller passed some, there is no message.
    const fileReport = check({ ...input, policy: { ...policy, source: "file", version: null } } as never);
    expect(fileReport.messages.some((m) => m.code === "POLICY_KEYS_UNKNOWN")).toBe(false);
    // Nothing skipped, no message.
    const quiet = check({ ...input, policy: { ...policy, unknownKeys: { names: [], total: 0 } } } as never);
    expect(quiet.messages.some((m) => m.code === "POLICY_KEYS_UNKNOWN")).toBe(false);
  });
});
