import { describe, expect, it } from "vitest";
import type { ResolveInputsResult } from "../src/inputs.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument } from "../src/policy/types.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// ti17-always-true-matcher-2, AC-15. resolveInputs(), applyPolicy() and check() are loaded inside the test body: the
// AC test is written before TI17 exists. The change is the one of AC-14 (the vitest Skylos case always-true-matcher
// with a passing coverage), so TI17 is the only finding and the verdict follows it.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CASE = "skylos-nine/always-true-matcher";
const PASSING_LCOV = "SF:src/cart.ts\nDA:1,1\nend_of_record\n";
const ID = ["TI", "17"].join("");
const CODE = ["TEST_INTEGRITY_", ID].join("");
const TEXT = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};

// The signal id is built at run time, so `signals` is keyed by string; the casts say it is a policy document.
const app = (signals: Record<string, string>): ResolvedPolicy => ({
  source: "app",
  version: 3,
  fetchedAt: "2026-11-09T12:00:00.000Z",
  document: { version: 1, test_integrity: { signals } } as PolicyDocument,
});
const file = (signals: Record<string, string>): ResolvedPolicy => ({
  source: "file",
  version: null,
  path: "policy/org.json",
  document: { version: 1, test_integrity: { signals } } as PolicyDocument,
});

/** check() on the AC-14 change, with the input mode given and the policy applied through applyPolicy(). */
async function run(policy: ResolvedPolicy, inputMode: "block" | "warn"): Promise<Report> {
  const { resolveInputs } = await import("../src/inputs.js");
  const { applyPolicy } = await import("../src/policy/apply.js");
  const { check } = await import("./text-coverage.js");
  const raw = { coverageFile: "coverage/lcov.info", testIntegrity: inputMode };
  const resolved = resolveInputs({}, raw, TEXT);
  expect(resolved.ok).toBe(true);
  const application = applyPolicy(
    { config: {}, raw, resolved: (resolved as Extract<ResolveInputsResult, { ok: true }>).inputs },
    policy,
  );
  const report = check({
    version: "0.1.0",
    coverage: { text: PASSING_LCOV, format: "lcov" },
    diff: { text: fixture(`${CASE}/change.diff`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture(`${CASE}/files.txt`).trim().split("\n"),
    ...(application.inputs.testIntegrityMode === undefined
      ? {}
      : { testIntegrityMode: application.inputs.testIntegrityMode }),
    policy,
    policyIgnored: application.ignored,
    signalOverrides: application.signalOverrides,
  });
  expectValidReport(report);
  return report;
}

const severities = (report: Report) => report.testIntegrity.signals.filter((s) => s.id === ID).map((s) => s.severity);
const levels = (report: Report) => report.messages.filter((m) => m.code === CODE).map((m) => m.level);

describe("TI17 severity from an org policy", () => {
  it("AC-15: an app policy TI17 block fails the check and off drops the finding; a policy file's info is ignored with POLICY_OVERRIDE_IGNORED naming test_integrity.signals.TI17; mode warn caps an app block at warn", async () => {
    const raised = await run(app({ [ID]: "block" }), "block");
    expect(severities(raised), "app block: severity").toEqual(["block"]);
    expect(levels(raised), "app block: message level").toEqual(["error"]);
    expect(raised.verdict, "app block: verdict").toBe("fail");

    const dropped = await run(app({ [ID]: "off" }), "block");
    expect(severities(dropped), "app off: no signal").toEqual([]);
    expect(levels(dropped), "app off: no message").toEqual([]);

    const lowered = await run(file({ [ID]: "info" }), "block");
    expect(severities(lowered), "file info: severity stays warn").toEqual(["warn"]);
    const ignored = lowered.messages.filter((m) => m.code === "POLICY_OVERRIDE_IGNORED");
    expect(ignored, "file info: one POLICY_OVERRIDE_IGNORED").toHaveLength(1);
    expect(ignored[0]?.text).toContain(`test_integrity.signals.${ID}`);

    const capped = await run(app({ [ID]: "block" }), "warn");
    expect(severities(capped), "mode warn with app block: severity").toEqual(["warn"]);
  });
});
