import { describe, expect, it } from "vitest";
import type { InputErrorText, RawInputs } from "../src/inputs.js";
import type { PolicyFileBase } from "../src/policy/agents.js";
import type { PolicyApplication, PolicyLayers } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument } from "../src/policy/types.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-348 (file-policy-base-union), AC-9. applyPolicy(), resolveInputs(), resolveDependencySettings(),
// parseJunitSources() and check() are loaded inside the test body: the AC test is written before applyPolicy unites a
// `file:` policy with its merge-base copy, so nothing the build adds may run while this file loads. The base copy turns
// the dependency lookups on, raises both floors above the defaults (30 days, 100 downloads) and turns the quarantine
// list off; the head copy lowers or flips each, deletes the keys, or deletes both objects. junit/failing.xml holds two
// failed tests that the quarantine list names.

const TEXT: InputErrorText = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};
const QUARANTINE = ["api.users::creates a user", "api.orders::cancels an order", "io.read::reads a file"];
const BASE_DOCUMENT: PolicyDocument = {
  version: 1,
  dependencies: { lookup: true, min_age_days: 60, min_weekly_downloads: 500 },
  flaky: { quarantine: false },
};
const SETTINGS = [
  "dependencies.lookup",
  "dependencies.min_age_days",
  "dependencies.min_weekly_downloads",
  "flaky.quarantine",
];

/** applyPolicy() as this change gives it: the merge-base copy as a third argument, the policy it used in `policy`. */
type Uniting = (
  layers: PolicyLayers,
  policy: ResolvedPolicy,
  base?: PolicyFileBase,
) => PolicyApplication & { policy?: ResolvedPolicy };

describe("a file: policy's head copy cannot loosen dependencies or flaky", { timeout: 60_000 }, () => {
  it("AC-9: the dependency settings resolve to lookup with the base's floors, the quarantine list is not applied, and each lowered setting is recorded looser", async () => {
    const core = { ...(await import("@pharn-ci/core")), check: (await import("./text-coverage.js")).check };
    const applyPolicy: Uniting = core.applyPolicy;
    const base: PolicyFileBase = { kind: "document", document: BASE_DOCUMENT };
    const raw: RawInputs = { coverageFile: "coverage/lcov.info" };
    const resolved = core.resolveInputs({}, raw, TEXT);
    expect(resolved.ok).toBe(true);
    // Narrows the type only: the expect above has already failed the test when resolveInputs did not succeed.
    if (!resolved.ok) throw new Error("resolveInputs failed");

    const heads: Array<[string, PolicyDocument]> = [
      [
        "head lowers and flips each",
        {
          version: 1,
          dependencies: { lookup: false, min_age_days: 10, min_weekly_downloads: 50 },
          flaky: { quarantine: true },
        },
      ],
      ["head deletes the keys", { version: 1, dependencies: {}, flaky: {} }],
      ["head deletes both objects", { version: 1 }],
    ];
    for (const [name, head] of heads) {
      const policy: ResolvedPolicy = { source: "file", version: null, path: "policy/org.json", document: head };
      const application = applyPolicy({ config: {}, raw, resolved: resolved.inputs }, policy, base);
      expect(application.policy, `${name}: applyPolicy returns the policy the run uses`).toBeDefined();
      const settings = core.resolveDependencySettings(application.inputs.dependencies);
      expect(
        { mode: settings.mode, minAgeDays: settings.minAgeDays, minWeeklyDownloads: settings.minWeeklyDownloads },
        name,
      ).toEqual({ mode: "lookup", minAgeDays: 60, minWeeklyDownloads: 500 });
      for (const setting of SETTINGS) {
        expect(application.ignored, `${name}: ${setting}`).toContainEqual(
          expect.objectContaining({ setting, reason: "looser" }),
        );
      }

      const report = core.check({
        version: "0.8.0",
        coverage: { text: "SF:src/a.ts\nDA:1,1\nend_of_record\n", format: "lcov" },
        diff: { parsed: [{ path: "src/a.ts", oldPath: "src/a.ts", status: "modified", addedLines: [1] }] },
        threshold: null,
        repoFiles: ["AGENTS.md", "src/a.ts"],
        junit: core.parseJunitSources({ files: [{ path: "reports/failing.xml", text: fixture("junit/failing.xml") }] }),
        quarantine: QUARANTINE,
        policy: application.policy,
        policyIgnored: application.ignored,
        policyFileBase: base,
      });
      expectValidReport(report);
      expect(report.flaky?.failed, `${name}: control, the results hold failed tests`).toBeGreaterThan(0);
      expect(report.flaky?.quarantinedFailures, `${name}: no failure is quarantined`).toBe(0);
      expect(report.flaky?.unquarantinedFailures, name).toBe(report.flaky?.failed);
      expect(report.flaky?.quarantined, name).toEqual([]);
    }
  });
});
