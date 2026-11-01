import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// applyPolicy(), fetchPolicy(), readPolicyFile(), run() and the fixtures under fixtures/policy-api/ are loaded inside
// the test body: the AC test is written before the org policy exists, so nothing the build adds may run while the
// file loads. fetchPolicy() and run() get a fake fetch serving one envelope; readPolicyFile() reads a real temporary
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

type Ignored = { setting: string; layer: string; reason: string };
type Application = { inputs: Record<string, unknown>; ignored: Ignored[]; acceptLabel?: string };
type Message = { level: string; code: string; text: string };

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

const app = (document: unknown) => ({ source: "app", version: 3, fetchedAt: NOW.toISOString(), document });
const file = (document: unknown) => ({ source: "file", version: null, path: "policy/org.json", document });

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
  const report = JSON.parse(text) as { messages: Message[] };
  expectValidReport(report);
  return { report, calls };
}

describe("policy keys this item does not apply", () => {
  it("AC-24: policy.required from a file is not allowed and from the app changes nothing; agents, dependencies, flaky and setup.forbidden_files are carried, not applied; applyPolicy is pure", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as {
      resolveInputs: (config: unknown, raw: unknown, text: unknown) => { ok: boolean; inputs: Record<string, unknown> };
      applyPolicy: (layers: unknown, policy: unknown) => Application;
    };
    const raw = { coverageFile: "coverage/lcov.info", threshold: "70", testIntegrity: "warn", exclude: ["src/**"] };
    const config = { coverage: { exclude: ["docs/**"] }, setup: { require: false } };
    const resolved = core.resolveInputs(config, raw, TEXT);
    expect(resolved.ok).toBe(true);
    const layers = { config, raw, resolved: resolved.inputs };

    const fileRequired = core.applyPolicy(layers, file(REQUIRED));
    expect(fileRequired.ignored).toEqual([{ setting: "policy.required", layer: "policy-file", reason: "not-allowed" }]);
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

    for (const policy of [app(CARRIED), file(CARRIED)]) {
      const first = core.applyPolicy(layers, policy);
      expect(first.ignored, policy.source).toEqual([]);
      expect(first.inputs, policy.source).toEqual(resolved.inputs);
      expect(first.acceptLabel, policy.source).toBeUndefined();
      // Pure: the same arguments give deep-equal results, and the arguments are not changed.
      expect(core.applyPolicy(layers, policy), policy.source).toEqual(first);
    }
    expect(layers.resolved).toEqual(core.resolveInputs(config, raw, TEXT).inputs);

    // The carried keys stay in the document the fetch and the file reader return.
    const { fetchPolicy } = await import("../src/policy-fetch.js");
    const h = harness({ context: prContext() as never });
    withPolicyDeps(h, envelopeFor(CARRIED));
    const fetched = (await fetchPolicy(h.deps as never, {
      mode: "auto",
      origin: new URL("https://pharn.dev"),
      repository: "acme/widgets",
    })) as { source: string; document: unknown };
    expect(fetched.source).toBe("app");
    expect(fetched.document).toEqual(CARRIED);

    const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-policy3-keys-")));
    try {
      mkdirSync(join(dir, "policy"));
      writeFileSync(join(dir, "policy/org.json"), JSON.stringify(CARRIED));
      const nodeIo = (await import("../../node-io/src/index.js")) as unknown as {
        readPolicyFile: (deps: unknown, options: { root: string; path: string; label: string }) => Promise<unknown>;
        lstatPath: unknown;
      };
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
