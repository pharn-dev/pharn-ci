import { describe, expect, it } from "vitest";
import type { CheckInput } from "../src/check.js";
import { resolveInputs } from "../src/inputs.js";
import { applyPolicy } from "../src/policy/apply.js";
import { dependencyCase, run } from "./dependencies-helpers.js";

// d05-private-registry-allowlist, AC-8: an app policy that carries dependencies.allowed_hosts replaces the workflow
// input's list. A host only the input names stays off the registry (D05 block), and one POLICY_OVERRIDE_IGNORED warning
// names the ignored setting and its layer, never a host. check() runs on the fixtures/dependencies/d05-lockfile case with
// its head package-lock.json rewritten in memory so left-pad resolves from https://mirror.other.example/... .

const MIRROR = "mirror.other.example";
const TEXT = {
  coverageFormat: (v: string) => `bad format ${v}`,
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage-root",
  dependencies: "dependencies",
  dependencyAllowedHosts: "dependency-allowed-hosts",
  noCoverageFile: "no coverage file",
};

type Side = { files: Array<{ path: string; text: string }>; dropped: [] };
type Application = { inputs: { dependencies?: unknown }; ignored: unknown[] };

function privateHostCase(host: string, extra: Record<string, unknown>): CheckInput {
  const url = `https://${host}/api/npm/npm/left-pad/-/left-pad-1.3.0.tgz`;
  const input = dependencyCase("d05-lockfile", extra as Partial<CheckInput>);
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

function layersFor(raw: Record<string, unknown>) {
  const fullRaw = { coverageFile: "coverage/lcov.info", ...raw };
  const result = resolveInputs({}, fullRaw as never, TEXT as never);
  if (!result.ok) throw new Error(`the layers do not resolve: ${result.errors.map((e) => e.message).join("; ")}`);
  return { config: {}, raw: fullRaw, resolved: result.inputs };
}

describe("the app policy replaces the input's allowed hosts", () => {
  it("AC-8: an input host the app list does not name is D05 block, with one POLICY_OVERRIDE_IGNORED warning naming dependencies.allowed_hosts (input) and no host, and the verdict is not pass", () => {
    for (const appHosts of [[], ["npm.corp.example"]]) {
      const name = `app allowed_hosts ${JSON.stringify(appHosts)}`;
      const policy = {
        source: "app",
        version: 3,
        fetchedAt: "2026-11-08T12:00:00.000Z",
        document: { version: 1, dependencies: { allowed_hosts: appHosts } },
      };
      const application = applyPolicy(
        layersFor({ dependencyAllowedHosts: [MIRROR] }) as never,
        policy as never,
      ) as unknown as Application;
      const report = run(
        privateHostCase(MIRROR, {
          policy,
          policyIgnored: application.ignored,
          dependencySettings: application.inputs.dependencies,
        }),
      );
      const d05 = (report.dependencies?.signals ?? []).filter((s) => s.id === "D05");
      expect(
        d05.map((s) => [s.severity, s.path, s.name]),
        name,
      ).toEqual([["block", "package-lock.json", "left-pad"]]);
      const ignored = report.messages.filter((m) => m.code === "POLICY_OVERRIDE_IGNORED");
      expect(ignored, name).toHaveLength(1);
      expect(ignored[0]?.level, name).toBe("warn");
      expect(ignored[0]?.text, name).toContain("dependencies.allowed_hosts (input)");
      expect(ignored[0]?.text, name).not.toContain(MIRROR);
      expect(ignored[0]?.text, name).not.toContain("npm.corp.example");
      expect(report.verdict, name).not.toBe("pass");
    }
  });
});
