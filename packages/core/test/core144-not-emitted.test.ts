import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { DiffFile } from "../src/diff/unified.js";
import { renderMarkdown, type StaleInstructionSources } from "../src/index.js";
import type { InputErrorText, RawInputs } from "../src/inputs.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument } from "../src/policy/types.js";
import type { Report } from "../src/report.js";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";
import { codeRow } from "./codeTable.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { check, type TextCheckInput } from "./text-coverage.js";

// CORE-144 (R7.11, decision Q6): TI15 and SI04 are no longer emitted. Their message codes stay in the schema, so an
// older report that holds them still validates, and a policy that names TI15 still validates and is applied to the
// other signals. core's check() is the only producer of the report the CLI and the Action write, so a check() that
// emits neither is a CLI and an Action that emit neither; node-io's staleInstructions.test.ts asserts the reader runs
// no `git log`.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const SUMMER = ["SUMMER", "2024"].join("");

/** A modified file that adds `lines` at line 12. */
function add(path: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, `@@ -11,0 +12,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

/** What TI15 used to report: a source condition that compares with a literal a test in the same change adds. */
const TI15_SHAPES = [
  add("src/discount.test.ts", [`  expect(price("${SUMMER}")).toBe(0);`]) +
    add("src/discount.ts", [`  if (code === "${SUMMER}") return 0;`]),
  add("src/status.test.ts", ["  expect(label(4271)).toBe('x');"]) +
    add("src/status.ts", ["  switch (code) {", "    case 4271:", "      return 'x';", "  }"]),
  add("app/test_rules.py", [`    assert rule("${SUMMER}") == 0`]) +
    add("app/rules.py", [`    if code in ("${SUMMER}", "WINTER2024"):`, "        return 0"]),
];

describe("CORE-144: TI15 and SI04 are not emitted", () => {
  it("no report holds a TI15 signal or a TEST_INTEGRITY_TI15 message, in modes block and warn", async () => {
    for (const diff of TI15_SHAPES) {
      for (const mode of ["block", "warn"] as const) {
        const report = await runDiff(diff, mode);
        expect(signalsOf(report, "TI15"), mode).toEqual([]);
        expect(
          report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI15"),
          mode,
        ).toEqual([]);
        // The omitted counts are a buildReport() input (omittedSignals), never a report field.
        expect(report.testIntegrity).not.toHaveProperty("omitted");
      }
    }
  });

  it("no report holds an SI04 finding or a SETUP_STALE_SI04 message, even for an old untouched instruction file that names an edited file", () => {
    const diff: DiffFile[] = [{ path: "src/index.ts", oldPath: "src/index.ts", status: "modified", addedLines: [1] }];
    const sources = {
      instructions: { files: [{ path: "AGENTS.md", text: "The entry point is `src/index.ts`.\n" }], dropped: [] },
      // The commit times SI04 read, as a caller before CORE-144 passed them: they are no longer part of the input.
      commitTimes: { head: 2_000_000_000, files: [{ path: "AGENTS.md", time: 1_000_000_000 }] },
    } as unknown as StaleInstructionSources;
    const input: TextCheckInput = {
      version: "0.12.0",
      coverage: { text: "SF:src/index.ts\nDA:1,1\nend_of_record\n", format: "lcov" },
      diff: { parsed: diff },
      threshold: null,
      repoFiles: ["AGENTS.md", "src/index.ts"],
      staleInstructionSources: sources,
    };
    const report = check(input);
    expectValidReport(report);
    expect(report.setupHealth).toBeUndefined();
    expect(report.messages.map((m) => m.code)).not.toContain("SETUP_STALE_SI04");
  });

  it("an older report that holds TI15 and SI04 still validates, and both codes are still documented", () => {
    const older = JSON.parse(fixture("removed-signals/report-with-ti15-si04.json")) as Report & {
      setupHealth: NonNullable<Report["setupHealth"]>;
    };
    expectValidReport(older);
    expect(older.messages.map((m) => m.code)).toEqual(["TEST_INTEGRITY_TI15", "SETUP_STALE_SI04"]);
    expect(older.testIntegrity.signals.map((s) => s.id)).toEqual(["TI15"]);
    expect(older.setupHealth.stale.map((s) => s.id)).toEqual(["SI04"]);

    // CORE-140: the schema's code description is one sentence and a link to the code table of docs/output.md, which
    // keeps both rows; the schema still lists SI04 in the stale-finding id enum.
    expect(codeRow("TEST_INTEGRITY_TI15")).toContain("Not emitted since the release after v0.11.0");
    expect(codeRow("SETUP_STALE_SI04")).toContain("Not emitted since the release after v0.11.0");
    expect(read("schema/report.v2.json")).toContain('"enum": ["SI01", "SI02", "SI03", "SI04"]');

    // The renderer does not throw on it; it lists no SI04 finding, since core emits none.
    const markdown = renderMarkdown(older);
    expect(markdown).not.toContain("**SI04**");
  });

  it("a policy that sets a severity for TI15 still validates and is applied to the other signals", async () => {
    const core = {
      ...(await import("./text-coverage.js")),
      ...(await import("../src/inputs.js")),
      ...(await import("../src/policy/apply.js")),
      ...(await import("../src/policy/validate.js")),
    };
    const document: PolicyDocument = { version: 1, test_integrity: { signals: { TI15: "block", TI06: "block" } } };
    expect(core.validatePolicy(document).ok).toBe(true);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(JSON.parse(read("schema/policy.v1.json")));
    expect(validate(document)).toBe(true);

    const DIR = "policy-precedence/signals";
    const TEXT: InputErrorText = {
      coverageFormat: () => "unsupported coverage format",
      threshold: "threshold",
      exclude: "exclude",
      coverageRoot: "coverage root",
      noCoverageFile: "no coverage file",
    };
    const run = (policy: ResolvedPolicy | undefined) => {
      const raw: RawInputs = { coverageFile: "coverage/lcov.info", testIntegrity: "block" };
      const resolved = core.resolveInputs({}, raw, TEXT);
      expect(resolved.ok).toBe(true);
      // Narrows the type only: the expect above has already failed the test when resolveInputs did not succeed.
      if (!resolved.ok) throw new Error("resolveInputs failed");
      const application =
        policy === undefined
          ? { inputs: resolved.inputs, ignored: [], signalOverrides: undefined }
          : core.applyPolicy({ config: {}, raw, resolved: resolved.inputs }, policy);
      const report = core.check({
        version: "0.1.0",
        coverage: { text: fixture(`${DIR}/coverage.info`), format: "lcov" },
        diff: { text: fixture(`${DIR}/pr.diff`) },
        repoRoot: "/home/runner/work/demo/demo",
        threshold: application.inputs.threshold ?? null,
        repoFiles: fixture(`${DIR}/files.txt`).trim().split("\n"),
        testSources: JSON.parse(fixture(`${DIR}/sources.json`)),
        testIntegrityMode: application.inputs.testIntegrityMode,
        ...(policy === undefined
          ? {}
          : { policy, policyIgnored: application.ignored, signalOverrides: application.signalOverrides }),
      });
      expectValidReport(report);
      return report;
    };
    const severities = (report: ReturnType<typeof run>, id: string) =>
      report.testIntegrity.signals.filter((s) => s.id === id).map((s) => s.severity);

    const base = run(undefined);
    expect(new Set(severities(base, "TI06"))).toEqual(new Set(["warn"]));
    const count = severities(base, "TI06").length;
    for (const source of ["app", "file"] as const) {
      const policy: ResolvedPolicy =
        source === "app"
          ? { source, version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document }
          : { source, version: null, path: "policy/org.json", document };
      const report = run(policy);
      expect(severities(report, "TI06"), source).toEqual(Array(count).fill("block"));
      expect(severities(report, "TI15"), source).toEqual([]);
      const codes = report.messages.map((m) => m.code);
      expect(codes, source).not.toContain("TEST_INTEGRITY_TI15");
      expect(codes, source).not.toContain("POLICY_OVERRIDE_IGNORED");
      expect(codes, source).not.toContain("POLICY_KEYS_UNKNOWN");
    }
  });
});
