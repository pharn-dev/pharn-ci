import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// applyPolicy(), check() and resolveInputs() are loaded inside the test body: the AC test is written before the
// policy precedence exists, so nothing the build adds may run while the file loads. The layers are built the way the
// adapters build them, and applyPolicy's effective settings are passed to check() as the adapters pass them.

type Ignored = { setting: string; layer: string; reason: string };
type Application = { inputs: { testIntegrityMode?: unknown }; ignored: Ignored[] };
type Report = { testIntegrity: { mode: string; source: string }; messages: { code: string; level: string }[] };

const REPO_ROOT = "/home/runner/work/demo/demo";
const TEXT = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};

const app = (mode: string) => ({
  source: "app",
  version: 3,
  fetchedAt: "2026-10-26T12:00:00.000Z",
  document: { version: 1, test_integrity: { mode } },
});
const file = (mode: string) => ({
  source: "file",
  version: null,
  path: "policy/org.json",
  document: { version: 1, test_integrity: { mode } },
});

async function golden(extra: Record<string, unknown>): Promise<Report> {
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
  return report as unknown as Report;
}

const modeIgnored = (report: Report) => report.messages.filter((m) => m.code === "TEST_INTEGRITY_MODE_IGNORED");

describe("applyPolicy and check(): the test-integrity mode", () => {
  it("AC-21: the app mode is the max of the app and the given values, a file mode only raises, the source is policy when the policy's mode applies, and TEST_INTEGRITY_MODE_IGNORED is as at the base", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as {
      resolveInputs: (config: unknown, raw: unknown, text: unknown) => { ok: boolean; inputs: Record<string, unknown> };
      applyPolicy: (layers: unknown, policy: unknown) => Application;
    };
    const cases: Array<
      [
        string,
        Record<string, unknown>,
        string | undefined,
        ReturnType<typeof app> | ReturnType<typeof file>,
        string,
        string,
        Ignored[],
      ]
    > = [
      [
        "app block over input warn",
        {},
        "warn",
        app("block"),
        "block",
        "policy",
        [{ setting: "test_integrity.mode", layer: "input", reason: "looser" }],
      ],
      ["app off, nothing given", {}, undefined, app("off"), "off", "policy", []],
      ["app warn under input block", {}, "block", app("warn"), "block", "input", []],
      [
        "app block over config off",
        { testIntegrity: { mode: "off" } },
        undefined,
        app("block"),
        "block",
        "policy",
        [{ setting: "test_integrity.mode", layer: "config", reason: "looser" }],
      ],
      ["file block over the default", {}, undefined, file("block"), "block", "policy", []],
      [
        "file off under input warn",
        {},
        "warn",
        file("off"),
        "warn",
        "input",
        [{ setting: "test_integrity.mode", layer: "policy-file", reason: "looser" }],
      ],
    ];
    for (const [name, config, input, policy, mode, source, ignored] of cases) {
      const raw = { coverageFile: "coverage/lcov.info", ...(input === undefined ? {} : { testIntegrity: input }) };
      const resolved = core.resolveInputs(config, raw, TEXT);
      expect(resolved.ok, name).toBe(true);
      const application = core.applyPolicy({ config, raw, resolved: resolved.inputs }, policy);
      expect(application.ignored, name).toEqual(ignored);

      const report = await golden({
        ...(application.inputs.testIntegrityMode === undefined
          ? {}
          : { testIntegrityMode: application.inputs.testIntegrityMode }),
        policy,
        policyIgnored: application.ignored,
      });
      expect(report.testIntegrity.mode, name).toBe(mode);
      expect(report.testIntegrity.source, name).toBe(source);

      // The base commit's check() for the same input and config values, with no policy.
      const base = await golden(
        resolved.inputs.testIntegrityMode === undefined ? {} : { testIntegrityMode: resolved.inputs.testIntegrityMode },
      );
      expect(modeIgnored(report), name).toEqual(modeIgnored(base));
    }
  });
});
