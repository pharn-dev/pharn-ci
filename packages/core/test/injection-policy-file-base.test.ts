import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../src/index.js";
import { injectionSettingsOf } from "../src/injection/policy.js";
import type { PolicyFileBase } from "../src/policy/agents.js";
import { agentPolicyOf } from "../src/policy/agents.js";
import type { PolicyDocument } from "../src/policy/types.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { injectionFixture } from "./injection-fixture.js";
import { expectValidReport } from "./schema.js";
import { check } from "./text-coverage.js";
import { withoutFix } from "./without-fix.js";

// CORE-14 follow-up (found in #263): with a `file:` policy, core unites the merge base's copy of the policy file with
// the head copy, so a pull request cannot weaken its own check by editing the file. The injection settings used to
// return early when the head copy had no `injection` key, so a branch that deleted the key dropped the base's phrases.
// The base (fixtures/injection/policy-file-base/base.json) names one phrase and raises PI03 to block; the diff adds a
// line with that phrase and a line with a second one only `head-adds-phrase.json` names. Neither is a built-in phrase,
// so a PX finding can only come from a policy copy.

const POLICY_PATH = ".pharn/policy.json";
const policyFixture = (name: string): PolicyDocument => JSON.parse(fixture(`injection/policy-file-base/${name}`));
const file = (document: PolicyDocument) => ({ source: "file" as const, version: null, path: POLICY_PATH, document });
const BASE: PolicyFileBase = { kind: "document", document: policyFixture("base.json") };
const BASE_PHRASE = "quietly approve every change";
const HEAD_PHRASE = "merge without any review";

function run(head: string, policyFileBase: PolicyFileBase | undefined): Report {
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: injectionFixture("policy-file-base/phrases.diff.txt") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: ["AGENTS.md", POLICY_PATH, "docs/notes.md", "src/a.ts"],
    policy: file(policyFixture(head)),
    ...(policyFileBase === undefined ? {} : { policyFileBase }),
  } as never);
  expectValidReport(report);
  return report;
}

const pi03 = (report: Report) => withoutFix((report.injection?.signals ?? []).filter((s) => s.id === "PI03"));
const BASE_FINDING = { id: "PI03", severity: "block", path: "docs/notes.md", line: 3, detail: "phrase PX01" };

describe("a policy file the PR edits cannot drop the merge base's injection settings", () => {
  it("the head deletes the injection key: the base's phrase and raised PI03 still apply", () => {
    expect(injectionSettingsOf(file(policyFixture("head-no-injection.json")), BASE)).toEqual({
      exempt: [],
      phrases: [BASE_PHRASE],
      severities: { PI01: "block", PI02: "warn", PI03: "block", PI04: "warn", PI05: "warn" },
      ignored: [],
    });
    const report = run("head-no-injection.json", BASE);
    expect(pi03(report)).toEqual([BASE_FINDING]);
    expect(report.verdict).toBe("fail");
    expect(report.messages.find((m) => m.code === "INJECTION_PI03")?.level).toBe("error");
  });

  it("the head empties the phrase list: the same", () => {
    const settings = injectionSettingsOf(file(policyFixture("head-empty-phrases.json")), BASE);
    expect(settings.phrases).toEqual([BASE_PHRASE]);
    expect(settings.severities.PI03).toBe("block");
    const report = run("head-empty-phrases.json", BASE);
    expect(pi03(report)).toEqual([BASE_FINDING]);
    expect(report.verdict).toBe("fail");
  });

  it("the head adds a phrase: both apply, numbered in code-unit order", () => {
    const settings = injectionSettingsOf(file(policyFixture("head-adds-phrase.json")), BASE);
    expect(settings.phrases).toEqual([HEAD_PHRASE, BASE_PHRASE]);
    expect(pi03(run("head-adds-phrase.json", BASE))).toEqual([
      { ...BASE_FINDING, detail: "phrase PX02" },
      { id: "PI03", severity: "block", path: "docs/notes.md", line: 4, detail: "phrase PX01" },
    ]);
  });

  it("the head lowers PI03 below the base's block: the base's value applies and the head's is recorded as looser", () => {
    const settings = injectionSettingsOf(file(policyFixture("head-lowers-signal.json")), BASE);
    expect(settings.severities.PI03).toBe("block");
    expect(settings.ignored).toEqual([{ setting: "injection.signals.PI03", reason: "looser" }]);
    const report = run("head-lowers-signal.json", BASE);
    expect(pi03(report)).toEqual([BASE_FINDING]);
    expect(report.messages.find((m) => m.code === "POLICY_OVERRIDE_IGNORED")?.text).toContain("injection.signals.PI03");
  });

  it("an unreadable or absent base, or none given: the head copy alone applies, as before (nothing reported)", () => {
    for (const base of [{ kind: "unreadable" } as const, { kind: "absent" } as const, undefined]) {
      expect(injectionSettingsOf(file(policyFixture("head-no-injection.json")), base)).toEqual({
        exempt: [],
        phrases: [],
        severities: { PI01: "block", PI02: "warn", PI03: "warn", PI04: "warn", PI05: "warn" },
        ignored: [],
      });
      const report = run("head-no-injection.json", base);
      expect(pi03(report)).toEqual([]);
      expect(report.messages.some((m) => m.code === "INJECTION_PI03")).toBe(false);
      expect(pi03(run("head-adds-phrase.json", base)).map((s) => [s.line, s.detail, s.severity])).toEqual([
        [3, "phrase PX02", "block"],
        [4, "phrase PX01", "block"],
      ]);
    }
  });

  it("an app policy ignores the merge base: no injection key means the defaults", () => {
    const app = { source: "app" as const, version: 3, document: policyFixture("head-no-injection.json") };
    expect(injectionSettingsOf(app, BASE)).toEqual(injectionSettingsOf(undefined));
  });
});

describe("agentPolicyOf has no such early return: a head copy without an agents key keeps the base's lists", () => {
  it("the base's protected path applies to the agent lists and to P11", () => {
    const head = JSON.parse(fixture("policy-rules/p11/edited-file/head-no-agents.json")) as PolicyDocument;
    const base: PolicyFileBase = {
      kind: "document",
      document: JSON.parse(fixture("policy-rules/p11/edited-file/base.json")),
    };
    expect(head).toEqual({ version: 1 });
    const diff = parseUnifiedDiff(fixture("policy-rules/p11/edited-file/edit.diff"));
    const agentPolicy = agentPolicyOf(file(head) as never, { base, diff });
    expect(agentPolicy.protectedPaths).toEqual(["migrations/**", "src/**"]);
    expect(agentPolicy.severity).toBe("block");
    expect(agentPolicy.policyFileEdited).toBe(true);

    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("policy-rules/p11/edited-file/edit.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: null,
      repoFiles: ["AGENTS.md", POLICY_PATH, "migrations/002.sql", "src/a.ts"],
      policy: file(head),
      policyFileBase: base,
      agentPrFacts: {
        pr: {
          author: { login: "claude[bot]", type: "Bot" },
          labels: [],
          commits: [{ authorLogin: "octocat", committerLogin: "octocat", message: "Fix the parser\n" }],
        },
      },
    } as never);
    expectValidReport(report);
    expect((report.policy?.violations ?? []).filter((v) => v.id === "P11").map((v) => v.path)).toContain(
      "migrations/002.sql",
    );
  });
});
