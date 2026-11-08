import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// fix-hints (H6), AC-2. The core's fix tables are loaded inside the test body: the AC test is written before the build
// adds them. The codes come from the message-code description of schema/report.v2.json and the P ids from the rule
// files core has, so a code or id added later without an entry fails here.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const KINDS = [
  "add-test",
  "restore-test",
  "restore-assertion",
  "revert-config",
  "remove-dependency",
  "request-review",
  "split-pr",
  "none",
];

type Entry = { kind: string; hint: string };
type Tables = { MESSAGE_FIXES?: Record<string, Entry>; SIGNAL_FIXES?: Record<string, Entry> };

const range = (prefix: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(2, "0")}`);

/** Every message code the message-code description of schema/report.v2.json names. */
function documentedCodes(): string[] {
  const schema = JSON.parse(read("schema/report.v2.json")) as {
    $defs: { message: { properties: { code: { description: string } } } };
  };
  const description = schema.$defs.message.properties.code.description;
  return [...new Set(description.match(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g) ?? [])].sort();
}

/** The P ids core produces: one rule file packages/core/src/policy/rules/pNN.ts per id. */
function policyIds(): string[] {
  return readdirSync(new URL("packages/core/src/policy/rules/", ROOT))
    .filter((name) => /^p[0-9][0-9]\.ts$/.test(name))
    .map((name) => `P${name.slice(1, 3)}`)
    .sort();
}

function expectEntry(table: Record<string, Entry>, key: string): void {
  const entry = table[key];
  expect(entry, `${key} has an entry`).toBeDefined();
  expect(KINDS, `${key}: kind ${entry?.kind}`).toContain(entry?.kind);
  expect(typeof entry?.hint, `${key}: hint is a string`).toBe("string");
  expect((entry?.hint ?? "").trim().length, `${key}: hint is not empty`).toBeGreaterThan(0);
  expect((entry?.hint ?? "").length, `${key}: hint is at most 200 characters`).toBeLessThanOrEqual(200);
}

describe("fix hints: a table entry for every documented code and signal id", () => {
  it("AC-2: every message code the schema documents has an entry with a closed kind and a non-empty hint of at most 200 characters", async () => {
    const { MESSAGE_FIXES } = (await import("../src/index.js")) as unknown as Tables;
    expect(MESSAGE_FIXES, "MESSAGE_FIXES is exported").toBeDefined();
    const codes = documentedCodes();
    // Control: the extraction finds the codes of every era of the schema.
    for (const code of ["DIFF_COVERAGE_BELOW_THRESHOLD", "TEST_INTEGRITY_TI16", "POLICY_P14", "JUNIT_TOO_LARGE"]) {
      expect(codes, `the schema names ${code}`).toContain(code);
    }
    for (const code of codes) expectEntry(MESSAGE_FIXES ?? {}, code);
  });

  it("AC-2: every signal id the schema documents (TI01-TI16, the P ids core produces, SI01-SI04, PI01-PI05, D01-D05) has an entry with a closed kind and a non-empty hint of at most 200 characters", async () => {
    const { SIGNAL_FIXES } = (await import("../src/index.js")) as unknown as Tables;
    expect(SIGNAL_FIXES, "SIGNAL_FIXES is exported").toBeDefined();
    const ps = policyIds();
    // Control: P01 to P14 as core produces them (there is no rule P12).
    expect(ps).toContain("P01");
    expect(ps).toContain("P14");
    const ids = [...range("TI", 1, 16), ...ps, ...range("SI", 1, 4), ...range("PI", 1, 5), ...range("D", 1, 5)];
    for (const id of ids) expectEntry(SIGNAL_FIXES ?? {}, id);
    // Every entry of either table, not only the documented ones, follows the same rules.
    for (const key of Object.keys(SIGNAL_FIXES ?? {})) expectEntry(SIGNAL_FIXES ?? {}, key);
  });
});
