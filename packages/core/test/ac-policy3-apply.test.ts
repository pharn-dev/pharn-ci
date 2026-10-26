import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// applyPolicy(), check() and resolveInputs() are loaded inside each test body: the AC tests are written before the
// policy precedence exists, so nothing the build adds may run while the file loads. The layers are built the way the
// adapters build them: a PharnConfig, the raw inputs, and resolveInputs() over both. A policy is passed as a
// ResolvedPolicy of source "app" (served) or "file" (the PR-carried file: document).

type Layer = "input" | "config" | "policy-file";
type Ignored = { setting: string; layer: Layer; reason: "looser" | "not-allowed"; given?: number; applied?: number };
type Inputs = {
  threshold: number | null;
  exclude: string[];
  coverageRoot: string | undefined;
  requireAgentSetup: boolean;
  expectAgentSetup?: string[];
};
type Application = { inputs: Inputs; ignored: Ignored[] };
type Message = { level: string; code: string; text: string };

const REPO_ROOT = "/home/runner/work/demo/demo";
const TEXT = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};

type Document = Record<string, unknown>;
const app = (document: Document) => ({
  source: "app",
  version: 3,
  fetchedAt: "2026-10-26T12:00:00.000Z",
  document: { version: 1, ...document },
});
const file = (document: Document) => ({
  source: "file",
  version: null,
  path: "policy/org.json",
  document: { version: 1, ...document },
});
type Policy = ReturnType<typeof app> | ReturnType<typeof file>;

async function layersFor(config: Record<string, unknown>, raw: Record<string, unknown>) {
  const { resolveInputs } = await import("@pharn-ci/core");
  const fullRaw = { coverageFile: "coverage/lcov.info", ...raw };
  const result = resolveInputs(config as never, fullRaw as never, TEXT as never);
  if (!result.ok) throw new Error(`the layers do not resolve: ${result.errors.map((e) => e.message).join("; ")}`);
  return { config, raw: fullRaw, resolved: result.inputs as unknown as Inputs };
}

async function apply(layers: Awaited<ReturnType<typeof layersFor>>, policy: Policy): Promise<Application> {
  const { applyPolicy } = (await import("@pharn-ci/core")) as unknown as {
    applyPolicy: (layers: unknown, policy: unknown) => Application;
  };
  return applyPolicy(layers, policy);
}

/** check() on the golden inputs with an application's threshold and exclusions, its policy and ignored list. */
async function checkWith(application: Application, policy: Policy) {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold: application.inputs.threshold,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    exclude: application.inputs.exclude,
    policy,
    policyIgnored: application.ignored,
  } as never);
  expectValidReport(report);
  return report as unknown as { messages: Message[] };
}

const overrideMessages = (report: { messages: Message[] }) =>
  report.messages.filter((m) => m.code === "POLICY_OVERRIDE_IGNORED");

describe("applyPolicy: the coverage and setup keys", () => {
  it("AC-17: coverage.threshold is the max of the policy and the given values; an app value above a given one, or a file value below today's, is recorded with both numbers", async () => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>, Policy, number, Ignored[], string?]> =
      [
        [
          "app 80 over input 70",
          {},
          { threshold: "70" },
          app({ coverage: { threshold: 80 } }),
          80,
          [{ setting: "coverage.threshold", layer: "input", reason: "looser", given: 70, applied: 80 }],
          "coverage.threshold (input) 70 → 80",
        ],
        [
          "app 80 over config 70, no input",
          { coverage: { threshold: 70 } },
          {},
          app({ coverage: { threshold: 80 } }),
          80,
          [{ setting: "coverage.threshold", layer: "config", reason: "looser", given: 70, applied: 80 }],
          "coverage.threshold (config) 70 → 80",
        ],
        ["app 60 under input 70", {}, { threshold: "70" }, app({ coverage: { threshold: 60 } }), 70, []],
        ["app 80, nothing given", {}, {}, app({ coverage: { threshold: 80 } }), 80, []],
        ["file 80 over input 70", {}, { threshold: "70" }, file({ coverage: { threshold: 80 } }), 80, []],
        [
          "file 60 under input 70",
          {},
          { threshold: "70" },
          file({ coverage: { threshold: 60 } }),
          70,
          [{ setting: "coverage.threshold", layer: "policy-file", reason: "looser", given: 60, applied: 70 }],
          "coverage.threshold (policy-file) 60 → 70",
        ],
      ];
    for (const [name, config, raw, policy, threshold, ignored, text] of cases) {
      const application = await apply(await layersFor(config, raw), policy);
      expect(application.inputs.threshold, name).toBe(threshold);
      expect(application.ignored, name).toEqual(ignored);

      const messages = overrideMessages(await checkWith(application, policy));
      expect(messages, name).toHaveLength(ignored.length === 0 ? 0 : 1);
      if (text !== undefined) {
        expect(messages[0]?.level, name).toBe("warn");
        expect(messages[0]?.text, name).toContain(text);
      }
    }
  });

  it("AC-18: coverage.exclude from the app replaces every lower layer's; a file can never add exclusions; no record carries numbers and no message quotes a pattern", async () => {
    const config = { coverage: { exclude: ["docs/**"] } };
    const cases: Array<
      [string, Record<string, unknown>, Record<string, unknown>, Policy, string[] | "today", Ignored[]]
    > = [
      [
        "app gen/** over input src/** and config docs/**",
        config,
        { exclude: ["src/**"] },
        app({ coverage: { exclude: ["gen/**"] } }),
        ["gen/**"],
        [
          { setting: "coverage.exclude", layer: "config", reason: "looser" },
          { setting: "coverage.exclude", layer: "input", reason: "looser" },
        ],
      ],
      [
        "app [] over config docs/**",
        config,
        {},
        app({ coverage: { exclude: [] } }),
        [],
        [{ setting: "coverage.exclude", layer: "config", reason: "looser" }],
      ],
      [
        "app gen/** with input gen/**",
        {},
        { exclude: ["gen/**"] },
        app({ coverage: { exclude: ["gen/**"] } }),
        ["gen/**"],
        [],
      ],
      [
        "file src/**",
        config,
        {},
        file({ coverage: { exclude: ["src/**"] } }),
        "today",
        [{ setting: "coverage.exclude", layer: "policy-file", reason: "not-allowed" }],
      ],
      ["file []", config, {}, file({ coverage: { exclude: [] } }), "today", []],
    ];
    for (const [name, cfg, raw, policy, exclude, ignored] of cases) {
      const layers = await layersFor(cfg, raw);
      const application = await apply(layers, policy);
      expect(application.inputs.exclude, name).toEqual(exclude === "today" ? layers.resolved.exclude : exclude);
      expect(application.ignored, name).toEqual(ignored);
      for (const record of application.ignored) {
        expect("given" in record, name).toBe(false);
        expect("applied" in record, name).toBe(false);
      }
      const messages = overrideMessages(await checkWith(application, policy));
      expect(messages, name).toHaveLength(ignored.length === 0 ? 0 : 1);
      for (const message of messages) {
        for (const pattern of ["gen/**", "src/**", "docs/**"]) expect(message.text, name).not.toContain(pattern);
        if (ignored.length > 0) expect(message.text, name).toContain("coverage.exclude");
      }
    }
  });

  it("AC-19: coverage.root from the app is authoritative (null is the repo root); a file root is never applied; no message quotes a root", async () => {
    const cases: Array<
      [string, Record<string, unknown>, Record<string, unknown>, Policy, string | "repo" | "today", Ignored[]]
    > = [
      [
        "app pkg over input other",
        {},
        { coverageRoot: "other" },
        app({ coverage: { root: "pkg" } }),
        "pkg",
        [{ setting: "coverage.root", layer: "input", reason: "looser" }],
      ],
      [
        "app null over config pkg",
        { coverage: { root: "pkg" } },
        {},
        app({ coverage: { root: null } }),
        "repo",
        [{ setting: "coverage.root", layer: "config", reason: "looser" }],
      ],
      ["app pkg with input pkg", {}, { coverageRoot: "pkg" }, app({ coverage: { root: "pkg" } }), "pkg", []],
      [
        "file pkg",
        {},
        { coverageRoot: "other" },
        file({ coverage: { root: "pkg" } }),
        "today",
        [{ setting: "coverage.root", layer: "policy-file", reason: "not-allowed" }],
      ],
    ];
    for (const [name, cfg, raw, policy, root, ignored] of cases) {
      const layers = await layersFor(cfg, raw);
      const application = await apply(layers, policy);
      if (root === "repo") expect([undefined, "."], name).toContain(application.inputs.coverageRoot);
      else if (root === "today") expect(application.inputs.coverageRoot, name).toBe(layers.resolved.coverageRoot);
      else expect(application.inputs.coverageRoot, name).toBe(root);
      expect(application.ignored, name).toEqual(ignored);
      const messages = overrideMessages(await checkWith(application, policy));
      expect(messages, name).toHaveLength(ignored.length === 0 ? 0 : 1);
      for (const message of messages) {
        expect(message.text, name).toContain("coverage.root");
        expect(message.text, name).not.toMatch(/\bpkg\b/);
        expect(message.text, name).not.toMatch(/\bother\b/);
      }
    }
  });

  it("AC-20: setup.require true wins over any lower false; setup.expect is the union of every layer, lower layers first", async () => {
    const requireCases: Array<[string, Record<string, unknown>, Record<string, unknown>, Policy, Ignored[]]> = [
      [
        "app true over an explicit input false",
        {},
        { requireAgentSetup: false },
        app({ setup: { require: true } }),
        [{ setting: "setup.require", layer: "input", reason: "looser" }],
      ],
      [
        "app true over an explicit config false",
        { setup: { require: false } },
        {},
        app({ setup: { require: true } }),
        [{ setting: "setup.require", layer: "config", reason: "looser" }],
      ],
      ["app true, nothing given", {}, {}, app({ setup: { require: true } }), []],
      ["app false under input true", {}, { requireAgentSetup: true }, app({ setup: { require: false } }), []],
      ["file true, nothing given", {}, {}, file({ setup: { require: true } }), []],
      [
        "file false under input true",
        {},
        { requireAgentSetup: true },
        file({ setup: { require: false } }),
        [{ setting: "setup.require", layer: "policy-file", reason: "looser" }],
      ],
    ];
    for (const [name, cfg, raw, policy, ignored] of requireCases) {
      const application = await apply(await layersFor(cfg, raw), policy);
      expect(application.inputs.requireAgentSetup, name).toBe(true);
      expect(application.ignored, name).toEqual(ignored);
    }

    // `claude` is not a tool name resolveInputs accepts; applyPolicy unions names as given, so the layers are set
    // here by hand: the config's tools first, then the input's, as resolveInputs orders them.
    const lower = await layersFor({}, {});
    const appExpect = await apply(
      {
        config: { setup: { expect: ["claude"] } },
        raw: { ...lower.raw, expectAgentSetup: ["cursor"] },
        resolved: { ...lower.resolved, expectAgentSetup: ["claude", "cursor"] },
      },
      app({ setup: { expect: ["claude", "copilot"] } }),
    );
    expect(appExpect.inputs.expectAgentSetup).toEqual(["claude", "cursor", "copilot"]);
    expect(appExpect.ignored).toEqual([]);

    const fileExpect = await apply(
      await layersFor({}, { expectAgentSetup: ["cursor"] }),
      file({ setup: { expect: ["codex"] } }),
    );
    expect(fileExpect.inputs.expectAgentSetup).toEqual(["cursor", "codex"]);
    expect(fileExpect.ignored.filter((r) => r.setting === "setup.expect")).toEqual([]);
    expect(fileExpect.ignored).toEqual([]);
  });
});
