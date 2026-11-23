import { describe, expect, it } from "vitest";
import type { CheckInput } from "../src/check.js";
import { type InputErrorText, type RawInputs, resolveInputs } from "../src/inputs.js";
import { applyPolicy, type PolicyLayers } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import { dependencyCase, run } from "./dependencies-helpers.js";

// d05-private-registry-allowlist, AC-7: an app policy's dependencies.allowed_hosts allows a private registry host with
// no workflow input at all. The layers are built the way the adapters build them (resolveInputs() over the raw
// inputs), the policy is applied with applyPolicy(), and check() runs on the fixtures/dependencies/d05-lockfile case
// with its head package-lock.json rewritten in memory (left-pad from https://npm.corp.example/..., git entry removed).

const HOST = "npm.corp.example";
const TEXT: InputErrorText = {
  coverageFormat: (v: string) => `bad format ${v}`,
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage-root",
  dependencies: "dependencies",
  noCoverageFile: "no coverage file",
};

type Side = { files: Array<{ path: string; text: string }>; dropped: [] };
function privateHostCase(host: string, extra: Partial<CheckInput>): CheckInput {
  const url = `https://${host}/api/npm/npm/left-pad/-/left-pad-1.3.0.tgz`;
  const input = dependencyCase("d05-lockfile", extra);
  const sources = input.dependencySources as { base: Side; head: Side };
  const files = sources.head.files.map((f) => {
    if (f.path !== "package-lock.json") return f;
    const text = f.text
      .replace("https://packages.example.com/left-pad/-/left-pad-1.3.0.tgz", url)
      .replace(
        '    "node_modules/from-git": {\n      "version": "1.0.0",\n      "resolved": "git+ssh://git@github.com/someone/from-git.git#0123456789abcdef0123456789abcdef01234567"\n    },\n',
        "",
      )
      .replace(',\n      "dependencies": {\n        "from-git": "github:someone/from-git#v1.0.0"\n      }', "");
    if (!text.includes(url) || text.includes("from-git")) throw new Error("the fixture lockfile changed shape");
    return { path: f.path, text };
  });
  return { ...input, dependencySources: { base: sources.base, head: { files, dropped: [] } } };
}

function layersFor(raw: RawInputs): PolicyLayers {
  const fullRaw: RawInputs = { coverageFile: "coverage/lcov.info", ...raw };
  const result = resolveInputs({}, fullRaw, TEXT);
  if (!result.ok) throw new Error(`the layers do not resolve: ${result.errors.map((e) => e.message).join("; ")}`);
  return { config: {}, raw: fullRaw, resolved: result.inputs };
}

describe("an app policy's allowed hosts", () => {
  it("AC-7: with no input, the app policy's dependencies.allowed_hosts allows the host: no D05, no POLICY_OVERRIDE_IGNORED, policy source app", () => {
    const policy: ResolvedPolicy = {
      source: "app",
      version: 3,
      fetchedAt: "2026-11-08T12:00:00.000Z",
      document: { version: 1, dependencies: { allowed_hosts: [HOST] } },
    };
    const application = applyPolicy(layersFor({}), policy);
    const report = run(
      privateHostCase(HOST, {
        policy,
        policyIgnored: application.ignored,
        dependencySettings: application.inputs.dependencies,
      }),
    );
    expect(report.dependencies?.signals.filter((s) => s.id === "D05")).toEqual([]);
    expect(report.messages.filter((m) => m.code === "DEPENDENCY_D05")).toEqual([]);
    expect(report.messages.filter((m) => m.code === "POLICY_OVERRIDE_IGNORED")).toEqual([]);
    expect(report.policy?.source).toBe("app");
  });
});
