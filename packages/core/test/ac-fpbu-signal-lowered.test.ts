import { describe, expect, it } from "vitest";
import type { InputErrorText, RawInputs } from "../src/inputs.js";
import type { PolicyFileBase } from "../src/policy/agents.js";
import type { PolicyApplication, PolicyLayers } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument } from "../src/policy/types.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-348 (file-policy-base-union), AC-1. applyPolicy(), resolveInputs() and check() are loaded inside the test body:
// the AC test is written before applyPolicy unites a `file:` policy with its merge-base copy, so nothing the build adds
// may run while this file loads. The signals fixture gives TI06 at warn in mode block; the base copy raises it to block
// and the head copy lowers it, deletes the key or deletes the whole test_integrity object.

const REPO_ROOT = "/home/runner/work/demo/demo";
const DIR = "policy-precedence/signals";
const TEXT: InputErrorText = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};

/** applyPolicy() as this change gives it: the merge-base copy as a third argument, the policy it used in `policy`. */
type Uniting = (
  layers: PolicyLayers,
  policy: ResolvedPolicy,
  base?: PolicyFileBase,
) => PolicyApplication & { policy?: ResolvedPolicy };

const filePolicy = (document: PolicyDocument): ResolvedPolicy => ({
  source: "file",
  version: null,
  path: "policy/org.json",
  document,
});

/** The settings POLICY_OVERRIDE_IGNORED names, without the numbers a threshold carries. */
function ignoredNames(report: Report): string[] {
  return report.messages
    .filter((m) => m.code === "POLICY_OVERRIDE_IGNORED")
    .flatMap((m) => {
      const at = m.text.indexOf("applies: ");
      expect(at, "the message lists the settings after 'applies: '").toBeGreaterThan(-1);
      return m.text
        .slice(at + "applies: ".length)
        .replace(/\.$/, "")
        .split(", ")
        .map((entry) => entry.split(" ")[0] ?? "");
    });
}

/** The signals fixture through applyPolicy (with the base copy) and check(), in mode block from the input. */
async function run(head: PolicyDocument, base: PolicyFileBase): Promise<Report> {
  const core = { ...(await import("@pharn-ci/core")), check: (await import("./text-coverage.js")).check };
  const raw: RawInputs = { coverageFile: "coverage/lcov.info", testIntegrity: "block" };
  const resolved = core.resolveInputs({}, raw, TEXT);
  expect(resolved.ok).toBe(true);
  // Narrows the type only: the expect above has already failed the test when resolveInputs did not succeed.
  if (!resolved.ok) throw new Error("resolveInputs failed");
  const applyPolicy: Uniting = core.applyPolicy;
  const application = applyPolicy({ config: {}, raw, resolved: resolved.inputs }, filePolicy(head), base);
  expect(application.policy, "applyPolicy returns the policy the run uses").toBeDefined();
  const report = core.check({
    version: "0.1.0",
    coverage: { text: fixture(`${DIR}/coverage.info`), format: "lcov" },
    diff: { text: fixture(`${DIR}/pr.diff`) },
    repoRoot: REPO_ROOT,
    threshold: application.inputs.threshold ?? null,
    repoFiles: fixture(`${DIR}/files.txt`).trim().split("\n"),
    testSources: JSON.parse(fixture(`${DIR}/sources.json`)),
    testIntegrityMode: application.inputs.testIntegrityMode,
    policy: application.policy,
    policyIgnored: application.ignored,
    signalOverrides: application.signalOverrides,
    policyFileBase: base,
  });
  expectValidReport(report);
  return report;
}

describe("a file: policy's head copy cannot lower a signal its merge-base copy raised", { timeout: 60_000 }, () => {
  it("AC-1: base TI06 block, head warn / key deleted / test_integrity deleted: TI06's message is an error and POLICY_OVERRIDE_IGNORED names test_integrity.signals.TI06", async () => {
    const base: PolicyFileBase = {
      kind: "document",
      document: { version: 1, test_integrity: { mode: "block", signals: { TI06: "block" } } },
    };
    const heads: Array<[string, PolicyDocument]> = [
      ["head warn", { version: 1, test_integrity: { mode: "block", signals: { TI06: "warn" } } }],
      ["head deletes the key", { version: 1, test_integrity: { mode: "block", signals: {} } }],
      ["head deletes test_integrity", { version: 1 }],
    ];
    for (const [name, head] of heads) {
      const report = await run(head, base);
      const ti06 = report.messages.filter((m) => m.code === "TEST_INTEGRITY_TI06");
      expect(ti06.length, `${name}: control, the fixture triggers TI06`).toBeGreaterThan(0);
      expect(
        ti06.map((m) => m.level),
        name,
      ).toEqual(ti06.map(() => "error"));
      expect(
        report.testIntegrity.signals.filter((s) => s.id === "TI06").every((s) => s.severity === "block"),
        name,
      ).toBe(true);
      expect(ignoredNames(report), name).toContain("test_integrity.signals.TI06");
    }
  });
});
