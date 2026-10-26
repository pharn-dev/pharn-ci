import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// applyPolicy(), check(), acceptTestIntegrity() and the fixtures under fixtures/policy-precedence/signals/ are loaded
// inside the test body: the AC test is written before per-signal policy overrides exist, so nothing the build adds
// may run while the file loads. The fixture is written by the build, so the test first checks that, in mode block and
// with no policy, it gives TI01 at block, TI06 at warn and TI15 at info.

type Signal = { id: string; severity: string; path: string; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = {
  verdict: string;
  messages: Message[];
  testIntegrity: { mode: string; verdict: string; signals: Signal[]; accepted?: unknown };
};
type Application = {
  inputs: { threshold: number | null; testIntegrityMode?: unknown };
  signalOverrides?: unknown;
  ignored: unknown[];
};

const REPO_ROOT = "/home/runner/work/demo/demo";
const DIR = "policy-precedence/signals";
const TEXT = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};

const app = (testIntegrity: Record<string, unknown>) => ({
  source: "app",
  version: 3,
  fetchedAt: "2026-10-26T12:00:00.000Z",
  document: { version: 1, test_integrity: testIntegrity },
});
const file = (testIntegrity: Record<string, unknown>) => ({
  source: "file",
  version: null,
  path: "policy/org.json",
  document: { version: 1, test_integrity: testIntegrity },
});

/** check() on the signals fixture, with the input mode given and the policy applied through applyPolicy(). */
async function signalsRun(policy: unknown, inputMode: string | undefined): Promise<Report> {
  const core = (await import("@pharn-ci/core")) as unknown as {
    resolveInputs: (config: unknown, raw: unknown, text: unknown) => { ok: boolean; inputs: Record<string, unknown> };
    applyPolicy: (layers: unknown, policy: unknown) => Application;
    check: (input: unknown) => Report;
  };
  const raw = { coverageFile: "coverage/lcov.info", ...(inputMode === undefined ? {} : { testIntegrity: inputMode }) };
  const resolved = core.resolveInputs({}, raw, TEXT);
  expect(resolved.ok).toBe(true);
  const application =
    policy === undefined
      ? ({ inputs: resolved.inputs, ignored: [] } as unknown as Application)
      : core.applyPolicy({ config: {}, raw, resolved: resolved.inputs }, policy);
  const report = core.check({
    version: "0.1.0",
    coverage: { text: fixture(`${DIR}/coverage.info`), format: "lcov" },
    diff: { text: fixture(`${DIR}/pr.diff`) },
    repoRoot: REPO_ROOT,
    threshold: application.inputs.threshold ?? null,
    repoFiles: fixture(`${DIR}/files.txt`).trim().split("\n"),
    testSources: JSON.parse(fixture(`${DIR}/sources.json`)),
    ...(application.inputs.testIntegrityMode === undefined
      ? {}
      : { testIntegrityMode: application.inputs.testIntegrityMode }),
    ...(policy === undefined
      ? {}
      : { policy, policyIgnored: application.ignored, signalOverrides: application.signalOverrides }),
  });
  expectValidReport(report);
  return report;
}

const severities = (report: Report, id: string) =>
  report.testIntegrity.signals.filter((s) => s.id === id).map((s) => s.severity);
const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);

describe("per-signal severities from a policy", () => {
  it("AC-22: an app severity replaces the computed one, a file severity only raises, mode warn caps and off runs nothing, and the accept label downgrades last", async () => {
    const base = await signalsRun(undefined, "block");
    expect(severities(base, "TI01").length).toBeGreaterThan(0);
    expect(new Set(severities(base, "TI01"))).toEqual(new Set(["block"]));
    expect(new Set(severities(base, "TI06"))).toEqual(new Set(["warn"]));
    expect(new Set(severities(base, "TI15"))).toEqual(new Set(["info"]));
    expect(withCode(base, "TEST_INTEGRITY_TI15").length).toBeGreaterThan(0);
    const ti06Count = severities(base, "TI06").length;

    // App TI06: block replaces warn and fails.
    const raised = await signalsRun(app({ signals: { TI06: "block" } }), "block");
    expect(severities(raised, "TI06")).toEqual(Array(ti06Count).fill("block"));
    expect(severities(raised, "TI01")).toEqual(severities(base, "TI01"));
    expect(severities(raised, "TI15")).toEqual(severities(base, "TI15"));
    expect(raised.testIntegrity.verdict).toBe("fail");
    expect(raised.verdict).toBe("fail");

    // App TI15: off drops the finding, its message and its omitted-count entry.
    const dropped = await signalsRun(app({ signals: { TI15: "off" } }), "block");
    expect(severities(dropped, "TI15")).toEqual([]);
    expect(withCode(dropped, "TEST_INTEGRITY_TI15")).toEqual([]);
    for (const message of dropped.messages) expect(message.text).not.toContain("TI15");
    expect(severities(dropped, "TI06")).toEqual(severities(base, "TI06"));

    // File TI01: warn would lower a block: it is ignored and recorded.
    const lowered = await signalsRun(file({ signals: { TI01: "warn" } }), "block");
    expect(severities(lowered, "TI01")).toEqual(severities(base, "TI01"));
    const ignored = withCode(lowered, "POLICY_OVERRIDE_IGNORED");
    expect(ignored).toHaveLength(1);
    expect(ignored[0]?.text).toContain("test_integrity.signals.TI01 (policy-file)");

    // File TI06: block raises warn to block.
    const fileRaised = await signalsRun(file({ signals: { TI06: "block" } }), "block");
    expect(severities(fileRaised, "TI06")).toEqual(Array(ti06Count).fill("block"));
    expect(withCode(fileRaised, "POLICY_OVERRIDE_IGNORED")).toEqual([]);

    // Mode warn caps the raised TI06 at warn and does not fail.
    const capped = await signalsRun(app({ mode: "warn", signals: { TI06: "block" } }), undefined);
    expect(capped.testIntegrity.mode).toBe("warn");
    expect(severities(capped, "TI06")).toEqual(Array(ti06Count).fill("warn"));
    expect(capped.testIntegrity.signals.some((s) => s.severity === "block")).toBe(false);
    expect(capped.testIntegrity.verdict).not.toBe("fail");

    // Mode off reports no signal.
    const off = await signalsRun(app({ mode: "off", signals: { TI06: "block" } }), undefined);
    expect(off.testIntegrity.mode).toBe("off");
    expect(off.testIntegrity.signals).toEqual([]);

    // Mode block and the accept label honoured: the label downgrades the raised block last.
    const { acceptTestIntegrity } = (await import("@pharn-ci/core")) as unknown as {
      acceptTestIntegrity: (report: Report, accepted: { label: string; by: string }) => Report;
    };
    const blocked = await signalsRun(app({ mode: "block", signals: { TI06: "block" } }), undefined);
    expect(severities(blocked, "TI06")).toEqual(Array(ti06Count).fill("block"));
    const accepted = acceptTestIntegrity(blocked, { label: "pharn/accepted", by: "Reviewer-1" });
    expectValidReport(accepted);
    expect(severities(accepted, "TI06")).toEqual(Array(ti06Count).fill("warn"));
    expect(accepted.testIntegrity.verdict).not.toBe("fail");
    expect(accepted.testIntegrity.accepted).toEqual({ label: "pharn/accepted", by: "Reviewer-1" });
  });
});
