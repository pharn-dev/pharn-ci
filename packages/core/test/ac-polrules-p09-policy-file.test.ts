import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 22 (policy rules), AC-7. check() is loaded inside the test body and fixtures/policy-rules/ is read there
// too: the AC test is written before the build adds the rules and the fixtures, so nothing the build adds may run
// while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";
const FILE_POLICY = { source: "file", version: null, path: "policy/org.json", document: { version: 1 } };
const CLASS_1 = {
  id: "P09",
  severity: "block",
  path: "policy/org.json",
  line: null,
  detail: "this change edits the policy file it is checked against",
};

async function run(diffFixture: string): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture(diffFixture) },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "policy/org.json", "src/a.ts"],
    policy: FILE_POLICY,
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const p09 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P09");

describe("org policy rule P09: the policy file itself", { timeout: 60_000 }, () => {
  it("AC-7: a diff that edits the file policy, or renames it away, gives a P09 block violation at its path; a diff that does not touch it gives none", async () => {
    const edited = await run("policy-rules/p09-violates/gates.diff");
    expect(p09(edited)).toEqual([CLASS_1]);

    const renamed = await run("policy-rules/p09-violates/rename.diff");
    expect(p09(renamed)).toEqual([CLASS_1]);

    const untouched = await run("policy-rules/p09-complies/pr.diff");
    expect(untouched.policy).toBeDefined();
    expect(p09(untouched)).toEqual([]);
  });
});
