import { describe, expect, it } from "vitest";
import type { CheckInput } from "../src/check.js";
import { resolveDependencySettings } from "../src/dependencies/settings.js";
import { resolveInputs } from "../src/inputs.js";
import { applyPolicy } from "../src/policy/apply.js";
import { dependencyCase, run } from "./dependencies-helpers.js";

// d05-private-registry-allowlist, AC-9: an input host that the app policy's dependencies.allowed_hosts also names is
// not an ignored setting. applyPolicy() runs on layers built the way the adapters build them, and check() given the
// application's ignored list emits no POLICY_OVERRIDE_IGNORED message.

const HOST = "npm.corp.example";
const TEXT = {
  coverageFormat: (v: string) => `bad format ${v}`,
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage-root",
  dependencies: "dependencies",
  dependencyAllowedHosts: "dependency-allowed-hosts",
  noCoverageFile: "no coverage file",
};

type Application = { inputs: { dependencies?: unknown }; ignored: unknown[] };

function layersFor(raw: Record<string, unknown>) {
  const fullRaw = { coverageFile: "coverage/lcov.info", ...raw };
  const result = resolveInputs({}, fullRaw as never, TEXT as never);
  if (!result.ok) throw new Error(`the layers do not resolve: ${result.errors.map((e) => e.message).join("; ")}`);
  return { config: {}, raw: fullRaw, resolved: result.inputs };
}

describe("an input host the app policy also names", () => {
  it("AC-9: nothing is recorded as ignored, the host stays allowed, and no POLICY_OVERRIDE_IGNORED message is in the report", () => {
    for (const appHosts of [[HOST], ["mirror.other.example", HOST]]) {
      const name = `app allowed_hosts ${JSON.stringify(appHosts)}`;
      const policy = {
        source: "app",
        version: 3,
        fetchedAt: "2026-11-08T12:00:00.000Z",
        document: { version: 1, dependencies: { allowed_hosts: appHosts } },
      };
      const application = applyPolicy(
        layersFor({ dependencyAllowedHosts: [HOST] }) as never,
        policy as never,
      ) as unknown as Application;
      expect(application.ignored, name).toEqual([]);
      const settings = resolveDependencySettings(application.inputs.dependencies as never) as {
        allowedHosts?: string[];
      };
      expect([...(settings.allowedHosts ?? [])].sort(), name).toEqual([...appHosts].sort());

      const report = run(
        dependencyCase("d05-lockfile", {
          policy,
          policyIgnored: application.ignored,
          dependencySettings: application.inputs.dependencies,
        } as unknown as Partial<CheckInput>),
      );
      expect(
        report.messages.filter((m) => m.code === "POLICY_OVERRIDE_IGNORED"),
        name,
      ).toEqual([]);
    }
  });
});
