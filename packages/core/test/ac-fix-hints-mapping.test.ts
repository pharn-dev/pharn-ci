import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// fix-hints (H6), AC-4. The core's fix tables are loaded inside the test body: the AC test is written before the build
// adds them. The expected kinds are the SPEC's Data section, written out here.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

type Entry = { kind: string; hint: string };
type Tables = { MESSAGE_FIXES?: Record<string, Entry>; SIGNAL_FIXES?: Record<string, Entry> };

const range = (prefix: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(2, "0")}`);
const ids = (list: string) => list.split(" ");

/** The kind of every signal id, from the SPEC's Data section. */
const SIGNAL_KINDS: Record<string, string> = Object.fromEntries([
  ...ids("TI01 TI02 TI03 TI04").map((id) => [id, "restore-test"]),
  // ti17-always-true-matcher-2: TI17 asks for the assertion that can fail back, so it joins TI05 to TI07.
  ...ids("TI05 TI06 TI07 TI17").map((id) => [id, "restore-assertion"]),
  ...ids("TI09 TI10 TI11 TI13 TI14 P09 P13").map((id) => [id, "revert-config"]),
  ...ids("TI08 TI12 TI15 TI16 P02 P03 P04 P05 P06 P08 P11 D04").map((id) => [id, "request-review"]),
  ...range("PI", 1, 5).map((id) => [id, "request-review"]),
  ["P14", "split-pr"],
  ...ids("D01 D02 D03 D05").map((id) => [id, "remove-dependency"]),
  ...ids("SI01 SI02 SI03 SI04 P01 P07 P10").map((id) => [id, "none"]),
]);

/** The message code of a signal id: TEST_INTEGRITY_<id>, POLICY_<id>, INJECTION_<id>, SETUP_STALE_<id>, DEPENDENCY_<id>. */
function messageCodeOf(id: string): string {
  if (id.startsWith("TI")) return `TEST_INTEGRITY_${id}`;
  if (id.startsWith("PI")) return `INJECTION_${id}`;
  if (id.startsWith("SI")) return `SETUP_STALE_${id}`;
  if (id.startsWith("P")) return `POLICY_${id}`;
  return `DEPENDENCY_${id}`;
}

const OPERATIONAL = ids(
  "DIFF_COVERAGE_UNGATED NO_COVERABLE_CHANGES COVERAGE_FILE_MISSING COVERAGE_FILE_EMPTY COVERAGE_FORMAT_UNSUPPORTED " +
    "DIFF_UNAVAILABLE COVERAGE_PATHS_UNMATCHED COVERAGE_PATHS_PARTIALLY_UNMATCHED COVERAGE_LINES_SKIPPED " +
    "DIFF_BINARY_COVERED_FILE NO_AGENT_SETUP_FILES AGENT_SETUP_FILE_EMPTY AGENT_SETUP_EXPECTED_MISSING " +
    "TEST_INTEGRITY_MODE_IGNORED TEST_INTEGRITY_OFF TEST_INTEGRITY_INDEX_UNAVAILABLE TEST_INTEGRITY_TEXT_TRUNCATED " +
    "TEST_INTEGRITY_ACCEPTED TEST_INTEGRITY_ACCEPT_IGNORED AGENT_CONFIG_SECRET_UNSCANNED POLICY_UNAVAILABLE " +
    "POLICY_OVERRIDE_IGNORED POLICY_SETTINGS_INVALID UPLOAD_TOO_LARGE AGENT_PR_DETECTION_INCOMPLETE " +
    "INJECTION_TEXT_TRUNCATED JUNIT_NOT_FOUND JUNIT_INVALID JUNIT_TOO_LARGE FLAKY_QUARANTINED_FAILURES " +
    "DEPENDENCY_LOOKUP_UNAVAILABLE DEPENDENCY_CHECK_INCOMPLETE",
);

/** The kind of every message code, from the SPEC's Data section. */
const MESSAGE_KINDS: Record<string, string> = Object.fromEntries([
  ["DIFF_COVERAGE_BELOW_THRESHOLD", "add-test"],
  ["TESTS_NOT_EXERCISING_CHANGES", "add-test"],
  ["TEST_FILES_DELETED", "restore-test"],
  ["CONFIG_CHANGED_IN_DIFF", "request-review"],
  ["COVERAGE_FILE_TRACKED", "request-review"],
  ...range("AGENT_CONFIG_SECRET_S", 1, 11).map((code) => [code, "request-review"]),
  ...Object.entries(SIGNAL_KINDS).map(([id, kind]) => [messageCodeOf(id), kind]),
  ...OPERATIONAL.map((code) => [code, "none"]),
]);

function documentedCodes(): string[] {
  const schema = JSON.parse(read("schema/report.v2.json")) as {
    $defs: { message: { properties: { code: { description: string } } } };
  };
  return [
    ...new Set(schema.$defs.message.properties.code.description.match(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g) ?? []),
  ].sort();
}

async function tables(): Promise<Required<Tables>> {
  const { MESSAGE_FIXES, SIGNAL_FIXES } = (await import("../src/index.js")) as unknown as Tables;
  expect(MESSAGE_FIXES, "MESSAGE_FIXES is exported").toBeDefined();
  expect(SIGNAL_FIXES, "SIGNAL_FIXES is exported").toBeDefined();
  return { MESSAGE_FIXES: MESSAGE_FIXES ?? {}, SIGNAL_FIXES: SIGNAL_FIXES ?? {} };
}

describe("fix hints: the kind of every code and signal id", () => {
  it("AC-4: every signal id has the kind of the SPEC's Data mapping, and the table has no other id", async () => {
    const { SIGNAL_FIXES } = await tables();
    for (const [id, kind] of Object.entries(SIGNAL_KINDS)) {
      // P12 is not produced by core (no rule file), so it is the one id of the pattern with no entry required.
      expect(SIGNAL_FIXES[id]?.kind, id).toBe(kind);
    }
    for (const id of Object.keys(SIGNAL_FIXES))
      expect(Object.keys(SIGNAL_KINDS), `an id the SPEC maps: ${id}`).toContain(id);
  });

  it("AC-4: every message code has the kind of the SPEC's Data mapping, each signal-family message the kind of its signal, and the table has no other code", async () => {
    const { MESSAGE_FIXES, SIGNAL_FIXES } = await tables();
    // Every code the schema documents is one the Data section maps.
    for (const code of documentedCodes()) {
      expect(Object.keys(MESSAGE_KINDS), `the SPEC maps ${code}`).toContain(code);
      expect(MESSAGE_FIXES[code]?.kind, code).toBe(MESSAGE_KINDS[code]);
    }
    for (const [code, entry] of Object.entries(MESSAGE_FIXES)) {
      expect(Object.keys(MESSAGE_KINDS), `a code the SPEC maps: ${code}`).toContain(code);
      expect(entry.kind, code).toBe(MESSAGE_KINDS[code]);
    }
    // A signal-family message has the same kind as the signal id it reports.
    for (const id of Object.keys(SIGNAL_FIXES)) {
      const code = messageCodeOf(id);
      if (MESSAGE_FIXES[code] !== undefined) expect(MESSAGE_FIXES[code]?.kind, code).toBe(SIGNAL_FIXES[id]?.kind);
    }
  });

  it("AC-4: the named cases of the criterion", async () => {
    const { MESSAGE_FIXES, SIGNAL_FIXES } = await tables();
    const kindOf = (key: string) => SIGNAL_FIXES[key]?.kind ?? MESSAGE_FIXES[key]?.kind;
    const expectKind = (keys: string[], kind: string) => {
      for (const key of keys) expect(kindOf(key), key).toBe(kind);
    };
    expectKind([...ids("TI01 TI02 TI03 TI04"), "TEST_FILES_DELETED"], "restore-test");
    expectKind(ids("TI05 TI06 TI07 TI17"), "restore-assertion");
    expectKind(ids("TI09 TI10 TI11 TI13 TI14 P09 P13"), "revert-config");
    expectKind(
      [
        ...ids("TI08 TI12 TI15 TI16 P02 P03 P04 P05 P06 P08 P11 D04"),
        ...range("AGENT_CONFIG_SECRET_S", 1, 11),
        ...range("PI", 1, 5),
        "CONFIG_CHANGED_IN_DIFF",
        "COVERAGE_FILE_TRACKED",
      ],
      "request-review",
    );
    expectKind(["DIFF_COVERAGE_BELOW_THRESHOLD", "TESTS_NOT_EXERCISING_CHANGES"], "add-test");
    expectKind(["P14"], "split-pr");
    expectKind(ids("D01 D02 D03 D05"), "remove-dependency");
    expectKind([...ids("SI01 SI02 SI03 SI04 P01 P07 P10"), ...OPERATIONAL], "none");
  });
});
