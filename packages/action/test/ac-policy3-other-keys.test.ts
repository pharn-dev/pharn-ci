import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Report, ResolvedPolicy } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import type { PolicyDocument } from "../../core/src/policy/types.js";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// applyPolicy(), fetchAppPolicy(), readPolicyFile(), run() and the fixtures under fixtures/policy-api/ are loaded inside
// the test body: the AC test is written before the org policy exists, so nothing the build adds may run while the
// file loads. fetchAppPolicy() and run() get a fake fetch serving one envelope; readPolicyFile() reads a real temporary
// file.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const NOW = new Date("2026-10-26T12:00:00.000Z");
const TEXT = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};

/** Keys this item carries for later items and never applies. */
const CARRIED = {
  version: 1,
  setup: { forbidden_files: ["CLAUDE.local.md", ".claude/settings.local.json"] },
  flaky: { quarantine: true },
  agents: {
    labels: ["agent", "ai-generated"],
    protected_paths: [".github/workflows/**"],
    protected_paths_mode: "block",
    require_human_approval: false,
  },
  dependencies: { registries: ["npm", "pypi"], min_age_days: 30, min_weekly_downloads: 100 },
};
const REQUIRED = { version: 1, policy: { required: true } };

type Ok<T> = Extract<T, { ok: true }>;

// The documents are raw JSON objects handed straight to applyPolicy, so each is cast to the validated document type.
const app = (document: unknown): ResolvedPolicy => ({
  source: "app",
  version: 3,
  fetchedAt: NOW.toISOString(),
  document: document as PolicyDocument,
});
const file = (document: unknown): ResolvedPolicy => ({
  source: "file",
  version: null,
  path: "policy/org.json",
  document: document as PolicyDocument,
});

async function realReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

function envelopeFor(document: unknown): string {
  return JSON.stringify({ ...JSON.parse(read("fixtures/policy-api/envelope-valid.json")), policy: document });
}

function withPolicyDeps(h: ReturnType<typeof harness>, envelope: string) {
  const calls: string[] = [];
  Object.assign(h.deps, {
    fetch: async (input: unknown) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return new Response(envelope, { status: 200, headers: { "content-type": "application/json" } });
    },
    getIDToken: async () => "tok-SECRET-123",
    setSecret: () => {},
    hasOidcEnv: true,
    now: () => NOW,
    sleep: async () => {},
  });
  return calls;
}

const prContext = () => ({
  ...PR_CONTEXT,
  payload: { ...PR_CONTEXT.payload, repository: { full_name: "acme/widgets" } },
});

async function actionReport(policy: string, envelope: string) {
  const { run } = await import("../src/run.js");
  const h = harness({ inputs: { threshold: "80", policy }, context: prContext() as never });
  const calls = withPolicyDeps(h, envelope);
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`${policy}: no report was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { report, calls };
}

describe("policy keys this item does not apply", () => {
  it("AC-24: policy.required from a file is not allowed and from the app changes nothing; agents, dependencies, flaky and setup.forbidden_files are carried, not applied; applyPolicy is pure", async () => {
    const core = await import("@pharn-ci/core");
    const raw = { coverageFile: "coverage/lcov.info", threshold: "70", testIntegrity: "warn", exclude: ["src/**"] };
    const config = { coverage: { exclude: ["docs/**"] }, setup: { require: false } };
    // Typed as the ok result, which the next line asserts it is.
    const resolved = core.resolveInputs(config, raw, TEXT) as Ok<ReturnType<typeof core.resolveInputs>>;
    expect(resolved.ok).toBe(true);
    const layers = { config, raw, resolved: resolved.inputs };

    // CORE-123: a policy file's record carries no layer (it was "policy-file"); only an app policy's looser record has one.
    const fileRequired = core.applyPolicy(layers, file(REQUIRED));
    expect(fileRequired.ignored).toEqual([{ setting: "policy.required", reason: "not-allowed" }]);
    expect(fileRequired.inputs).toEqual(resolved.inputs);

    const appRequired = core.applyPolicy(layers, app(REQUIRED));
    expect(appRequired.ignored).toEqual([]);
    expect(appRequired.inputs).toEqual(resolved.inputs);

    // Under auto, a served policy.required true adds no message and changes nothing: the report is the never report.
    const never = await actionReport("never", envelopeFor(REQUIRED));
    const auto = await actionReport("auto", envelopeFor(REQUIRED));
    expect(auto.calls).toHaveLength(1);
    expect(auto.report.messages.filter((m) => m.code.startsWith("POLICY_"))).toEqual([]);
    // E3 item 22 (policy rules): a served policy now puts the `policy` object in the report (here with no violations);
    // it is asserted here, and the rest of the report is still the policy: never report.
    const { policy: autoPolicy, ...autoRest } = auto.report;
    expect(autoPolicy).toEqual({ source: "app", version: 7, fetchedAt: NOW.toISOString(), violations: [] });
    expect(autoRest).toEqual(never.report);

    // Re-pinned for dependency safety (A13, v0.8.0): `dependencies` is no longer only carried. It is applied into the
    // dependency settings (`resolveDependencySettings` reads them), and a policy file's `registries` would narrow what
    // is looked up, so it is not allowed; every other carried key is still carried, not applied.
    for (const policy of [app(CARRIED), file(CARRIED)]) {
      const first = core.applyPolicy(layers, policy);
      const isApp = policy.source === "app";
      expect(first.ignored, policy.source).toEqual(
        isApp ? [] : [{ setting: "dependencies.registries", reason: "not-allowed" }],
      );
      expect(first.inputs, policy.source).toEqual({
        ...resolved.inputs,
        dependencies: {
          policy: {
            kind: isApp ? "app" : "file",
            minAgeDays: 30,
            minWeeklyDownloads: 100,
            ...(isApp ? { registries: ["npm", "pypi"] } : {}),
          },
        },
      });
      expect(first.acceptLabel, policy.source).toBeUndefined();
      // Pure: the same arguments give deep-equal results, and the arguments are not changed.
      expect(core.applyPolicy(layers, policy), policy.source).toEqual(first);
    }
    expect(layers.resolved).toEqual((core.resolveInputs(config, raw, TEXT) as typeof resolved).inputs);

    // The carried keys stay in the document the fetch and the file reader return.
    const { fetchAppPolicy } = await import("../src/policy-fetch.js");
    const h = harness({ context: prContext() as never });
    withPolicyDeps(h, envelopeFor(CARRIED));
    const fetched = (
      await fetchAppPolicy(h.deps as never, {
        mode: "auto",
        origin: new URL("https://pharn.dev"),
        repository: "acme/widgets",
      })
    ).policy as { source: string; document: unknown };
    expect(fetched.source).toBe("app");
    expect(fetched.document).toEqual(CARRIED);

    const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-policy3-keys-")));
    try {
      mkdirSync(join(dir, "policy"));
      writeFileSync(join(dir, "policy/org.json"), JSON.stringify(CARRIED));
      const nodeIo = await import("../../node-io/src/index.js");
      const fromFile = (await nodeIo.readPolicyFile(
        { readFile: realReadFile, resolvePath: resolve, lstat: nodeIo.lstatPath },
        { root: dir, path: "policy/org.json", label: "the policy input" },
      )) as { source: string; document: unknown };
      expect(fromFile.source).toBe("file");
      expect(fromFile.document).toEqual(CARRIED);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
