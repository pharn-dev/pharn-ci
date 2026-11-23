import { describe, expect, it } from "vitest";
import { byCodeUnit } from "../src/text.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before CheckInput has `policy` and `policyIgnored`,
// so nothing the build adds may run while the file loads. The ignored settings are passed to check() directly, in a
// shuffled order, as 23 distinct settings (two of them given twice).
//
// CORE-123 (R5.6): the message names no layer: the same setting given twice (it was named once per layer) is named
// once. The records here carry no layer, which only P09 reads.

type Ignored = { setting: string; reason: "looser" | "not-allowed" };
type Message = { level: string; code: string; text: string };

const REPO_ROOT = "/home/runner/work/demo/demo";

const SETTINGS = [
  "coverage.exclude",
  "coverage.root",
  "coverage.threshold",
  "setup.require",
  "test_integrity.mode",
  "test_integrity.accept_label",
  "policy.required",
  "dependencies",
  "dependencies.allowed_hosts",
  "dependencies.registries",
  "injection.exempt",
  "injection.signals.PI01",
  "policy.rules.P01",
  ...Array.from({ length: 10 }, (_, i) => `test_integrity.signals.TI${String(i + 1).padStart(2, "0")}`),
];
const IGNORED: Ignored[] = [
  ...SETTINGS.map((setting) => ({ setting, reason: "looser" as const })),
  { setting: "coverage.exclude", reason: "not-allowed" },
  { setting: "test_integrity.mode", reason: "looser" },
];

/** The distinct records in code-unit order of the setting. */
const sorted = SETTINGS.map((setting) => ({ setting })).sort((a, b) => byCodeUnit(a.setting, b.setting));
/** A fixed shuffle, so the order check() is given is not the sorted one. */
const shuffled = IGNORED.map((record, i) => ({ record, key: (i * 7919) % IGNORED.length }))
  .sort((a, b) => a.key - b.key)
  .map(({ record }) => record);

async function checkWith(extra: Record<string, unknown>) {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    ...extra,
  } as never);
  expectValidReport(report);
  return report as unknown as { messages: Message[] };
}

const APP = { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: { version: 1 } };

describe("the two policy messages", () => {
  it("AC-25: one POLICY_OVERRIDE_IGNORED lists the first 20 settings sorted with no duplicate, then the count of the rest; POLICY_UNAVAILABLE comes directly before it, after every other message", async () => {
    expect(new Set(IGNORED.map((r) => r.setting)).size).toBe(23);
    expect(IGNORED).toHaveLength(25);
    expect(shuffled.map((r) => r.setting)).not.toEqual(sorted.map((r) => r.setting));

    const report = await checkWith({ policy: APP, policyIgnored: shuffled });
    const messages = report.messages.filter((m) => m.code === "POLICY_OVERRIDE_IGNORED");
    expect(messages).toHaveLength(1);
    const message = messages[0] as Message;
    expect(message.level).toBe("warn");
    expect(report.messages.at(-1)).toEqual(message);

    // The first 20 appear in sorted order, each once and with no layer; the last 3 are counted, not named. Each named
    // entry is a whole list item: after a space, before the comma that separates it from the next.
    let at = -1;
    for (const record of sorted.slice(0, 20)) {
      const entry = ` ${record.setting},`;
      const found = message.text.indexOf(entry);
      expect(found, entry).toBeGreaterThan(at);
      expect(message.text.indexOf(entry, found + 1), `${entry} once`).toBe(-1);
      at = found;
    }
    for (const record of sorted.slice(20)) {
      expect(message.text).not.toContain(` ${record.setting}`);
    }
    expect(message.text).not.toMatch(/\((?:input|config|policy-file)\)/);
    expect(message.text).toContain("and 3 more");
    expect(message.text.indexOf("and 3 more")).toBeGreaterThan(at);
    expect(message.text).toMatch(/policy['’]s value applies/i);

    // Both messages: POLICY_UNAVAILABLE directly before POLICY_OVERRIDE_IGNORED, both after every other message.
    const combined = await checkWith({
      policy: {
        source: "none",
        version: null,
        document: null,
        unavailable: { reason: "timeout", required: false },
      },
      policyIgnored: shuffled.slice(0, 2),
    });
    const codes = combined.messages.map((m) => m.code);
    expect(codes.filter((c) => c === "POLICY_UNAVAILABLE")).toHaveLength(1);
    expect(codes.filter((c) => c === "POLICY_OVERRIDE_IGNORED")).toHaveLength(1);
    expect(codes.slice(-2)).toEqual(["POLICY_UNAVAILABLE", "POLICY_OVERRIDE_IGNORED"]);
    const without = await checkWith({});
    expect(codes.slice(0, -2)).toEqual(without.messages.map((m) => m.code));
  });
});
