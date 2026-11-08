import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { check, injectionSettingsOf, type Report, validatePolicy } from "../src/index.js";
import type { PolicyDocument } from "../src/policy/types.js";
import { FIXTURES, fixture } from "./helpers.js";
import { injectionFixture } from "./injection-fixture.js";
import { expectValidReport } from "./schema.js";
import { withoutFix } from "./v090-codes.js";

// The `injection` policy key (schema/policy.v1.json, validatePolicy) and how each policy source applies it. Settings
// the pull request carries can never loosen the scan: a `file:` policy's exemptions are not-allowed, its severities
// only raise, and nothing in `.pharn/ci.yml` or the inputs reaches the scan at all.

const policySchema = JSON.parse(readFileSync(`${FIXTURES}../schema/policy.v1.json`, "utf8"));
const validateWithSchema = new Ajv2020({ strict: true, allErrors: true }).compile(policySchema);

const app = (document: PolicyDocument) => ({ source: "app" as const, version: 3, document });
const file = (document: PolicyDocument) => ({ source: "file" as const, version: null, path: "policy.json", document });

function run(diffName: string, policy: unknown, over: Record<string, unknown> = {}): Report {
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: injectionFixture(diffName) },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts"],
    policy,
    ...over,
  } as never);
  expectValidReport(report);
  return report;
}

describe("the injection policy key", () => {
  it("accepts exempt globs, phrases and PI01-PI05 severities in the validator and the schema alike", () => {
    const document = {
      version: 1,
      injection: { exempt: ["docs/security/**"], phrases: ["wire the money"], signals: { PI01: "warn", PI05: "off" } },
    };
    expect(validatePolicy(document)).toEqual({ ok: true, policy: document });
    expect(validateWithSchema(document)).toBe(true);
  });

  it("rejects an unknown key, an unknown signal, a bad glob and a phrase with a control character, in both", () => {
    const bad = [
      { version: 1, injection: { extra: true } },
      { version: 1, injection: { signals: { PI06: "warn" } } },
      { version: 1, injection: { signals: { TI01: "warn" } } },
      { version: 1, injection: { exempt: ["../outside"] } },
      { version: 1, injection: { phrases: ["two\nlines"] } },
      { version: 1, injection: { phrases: [""] } },
      { version: 1, injection: { signals: { PI01: "fatal" } } },
    ];
    for (const document of bad) {
      expect(validatePolicy(document).ok, JSON.stringify(document)).toBe(false);
      expect(validateWithSchema(document), JSON.stringify(document)).toBe(false);
    }
  });
});

describe("injectionSettingsOf", () => {
  it("uses the defaults without a policy, with a policy of source none and with no injection key", () => {
    const defaults = { PI01: "block", PI02: "warn", PI03: "warn", PI04: "warn", PI05: "warn" };
    for (const policy of [undefined, { source: "none" as const, version: null, document: null }, app({ version: 1 })]) {
      expect(injectionSettingsOf(policy)).toEqual({ exempt: [], phrases: [], severities: defaults, ignored: [] });
    }
  });

  it("applies an app policy as given: exemptions, phrases, replaced severities and off", () => {
    const settings = injectionSettingsOf(
      app({
        version: 1,
        injection: { exempt: ["b/**", "a/**", "a/**"], phrases: ["x"], signals: { PI01: "warn", PI03: "off" } },
      }),
    );
    expect(settings).toEqual({
      exempt: ["a/**", "b/**"],
      phrases: ["x"],
      severities: { PI01: "warn", PI02: "warn", PI03: null, PI04: "warn", PI05: "warn" },
      ignored: [],
    });
  });

  it("lets a policy file only tighten: no exemptions, phrases united with the merge base, severities only raised", () => {
    const settings = injectionSettingsOf(
      file({
        version: 1,
        injection: { exempt: ["docs/**"], phrases: ["head"], signals: { PI01: "off", PI02: "block", PI04: "warn" } },
      }),
      { kind: "document", document: { version: 1, injection: { phrases: ["base"] } } },
    );
    expect(settings).toEqual({
      exempt: [],
      phrases: ["base", "head"],
      severities: { PI01: "block", PI02: "block", PI03: "warn", PI04: "warn", PI05: "warn" },
      ignored: [
        { setting: "injection.exempt", layer: "policy-file", reason: "not-allowed" },
        { setting: "injection.signals.PI01", layer: "policy-file", reason: "looser" },
      ],
    });
  });
});

describe("the injection policy through check()", () => {
  it("an app policy can exempt a path, switch a signal off and lower PI01", () => {
    const exempted = run("trojan-source.diff.txt", app({ version: 1, injection: { exempt: ["src/**"] } }));
    expect(exempted.injection).toBeUndefined();

    const lowered = run("trojan-source.diff.txt", app({ version: 1, injection: { signals: { PI01: "warn" } } }));
    expect(lowered.injection?.signals.map((s) => s.severity)).toEqual(["warn", "warn"]);
    expect(lowered.messages.find((m) => m.code === "INJECTION_PI01")?.level).toBe("warn");

    const off = run(
      "literature-sample.diff.txt",
      app({ version: 1, injection: { signals: { PI02: "off", PI03: "off" } } }),
    );
    expect(off.injection).toBeUndefined();
    expect(off.messages.some((m) => m.code.startsWith("INJECTION_PI"))).toBe(false);
  });

  it("an app policy's phrases add PX findings", () => {
    const report = run("pi02-clean.diff.txt", app({ version: 1, injection: { phrases: ["keep this list sorted"] } }));
    // fix-hints (H6): every finding now carries a `fix`; the pinned literal is unchanged, so it is read without it.
    expect(withoutFix(report.injection?.signals)).toEqual([
      { id: "PI02", severity: "warn", path: "README.md", line: 8, detail: "phrase PX01 in an HTML comment" },
    ]);
  });

  it("a policy file cannot exempt a path or lower PI01, and the report says the settings were not applied", () => {
    const report = run(
      "trojan-source.diff.txt",
      file({ version: 1, injection: { exempt: ["src/**"], signals: { PI01: "info" } } }),
    );
    expect(report.verdict).toBe("fail");
    expect(report.injection?.signals.map((s) => s.severity)).toEqual(["block", "block"]);
    const ignored = report.messages.find((m) => m.code === "POLICY_OVERRIDE_IGNORED");
    expect(ignored?.text).toContain("injection.exempt (policy-file)");
    expect(ignored?.text).toContain("injection.signals.PI01 (policy-file)");
  });

  it("a policy file can raise a warning signal to block", () => {
    const report = run("literature-sample.diff.txt", file({ version: 1, injection: { signals: { PI03: "block" } } }));
    expect(report.verdict).toBe("fail");
    expect(report.messages.find((m) => m.code === "INJECTION_PI03")?.level).toBe("error");
  });
});
