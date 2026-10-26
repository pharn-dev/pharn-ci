import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before CheckInput has `policy` and `policyIgnored`,
// so nothing the build adds may run while the file loads. The ignored settings are passed to check() directly, in a
// shuffled order, as 23 distinct setting and layer pairs.

type Layer = "input" | "config" | "policy-file";
type Ignored = { setting: string; layer: Layer; reason: "looser" | "not-allowed" };
type Message = { level: string; code: string; text: string };

const REPO_ROOT = "/home/runner/work/demo/demo";

const IGNORED: Ignored[] = [
  ...(["config", "input", "policy-file"] as const).flatMap((layer) =>
    ["coverage.exclude", "coverage.root", "setup.require"].map((setting) => ({
      setting,
      layer,
      reason: layer === "policy-file" && setting !== "setup.require" ? ("not-allowed" as const) : ("looser" as const),
    })),
  ),
  { setting: "test_integrity.mode", layer: "config", reason: "looser" },
  { setting: "test_integrity.mode", layer: "input", reason: "looser" },
  { setting: "test_integrity.accept_label", layer: "policy-file", reason: "not-allowed" },
  { setting: "policy.required", layer: "policy-file", reason: "not-allowed" },
  ...Array.from({ length: 10 }, (_, i) => ({
    setting: `test_integrity.signals.TI${String(i + 1).padStart(2, "0")}`,
    layer: "policy-file" as const,
    reason: "looser" as const,
  })),
];

/** Code-unit order, by setting then layer. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = [...IGNORED].sort((a, b) => compare(a.setting, b.setting) || compare(a.layer, b.layer));
/** A fixed shuffle, so the order check() is given is not the sorted one. */
const shuffled = IGNORED.map((record, i) => ({ record, key: (i * 7919) % 23 }))
  .sort((a, b) => a.key - b.key)
  .map(({ record }) => record);

async function checkWith(extra: Record<string, unknown>) {
  const { check } = await import("@pharn-ci/core");
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
    expect(new Set(IGNORED.map((r) => `${r.setting} ${r.layer}`)).size).toBe(23);
    expect(shuffled).not.toEqual(sorted);

    const report = await checkWith({ policy: APP, policyIgnored: shuffled });
    const messages = report.messages.filter((m) => m.code === "POLICY_OVERRIDE_IGNORED");
    expect(messages).toHaveLength(1);
    const message = messages[0] as Message;
    expect(message.level).toBe("warn");
    expect(report.messages.at(-1)).toEqual(message);

    // The first 20 appear in sorted order, each once; the last 3 are counted, not named.
    let at = -1;
    for (const record of sorted.slice(0, 20)) {
      const entry = `${record.setting} (${record.layer})`;
      const found = message.text.indexOf(entry);
      expect(found, entry).toBeGreaterThan(at);
      expect(message.text.indexOf(entry, found + 1), `${entry} once`).toBe(-1);
      at = found;
    }
    for (const record of sorted.slice(20)) {
      expect(message.text).not.toContain(`${record.setting} (${record.layer})`);
    }
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
