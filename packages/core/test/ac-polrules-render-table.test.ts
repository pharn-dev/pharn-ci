import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 22 (policy rules), AC-17. check() and renderMarkdown() are loaded inside the test body and
// fixtures/policy-rules/ is read there too: the AC test is written before the build adds the Policy column and the
// fixtures, so nothing the build adds may run while this file loads. The golden inputs are passed as
// packages/core/test/golden.test.ts passes them, and the no-policy comment is compared byte for byte with the
// committed golden, never through a file snapshot.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = Record<string, unknown> & { messages: Message[]; policy?: { violations: Violation[] } };

interface Core {
  check(input: unknown): Report;
  renderMarkdown(report: Report, options?: { maxRows?: number }): string;
}

const ROOT = new URL("../../../", import.meta.url);
const REPO_ROOT = "/home/runner/work/demo/demo";
const HEADER = "| Verdict | Diff coverage | Test integrity | Agent setup | Policy |";
const SEPARATOR = "| --- | --- | --- | --- | --- |";
const POLICY_CODES = ["POLICY_P08", "POLICY_P09", "POLICY_UNAVAILABLE", "POLICY_OVERRIDE_IGNORED"];
const P01_CODES = ["NO_AGENT_SETUP_FILES", "AGENT_SETUP_EXPECTED_MISSING"];

/** The lines of the Messages section, from its heading to the next heading or rule (exclusive). */
function messagesSection(md: string): string[] {
  const lines = md.split("\n");
  const at = lines.findIndex((l) => l.startsWith("### 💬 Messages"));
  expect(at, "the Messages heading").toBeGreaterThanOrEqual(0);
  const next = lines.findIndex((l, i) => i > at && (l.startsWith("### ") || l === "---"));
  return lines.slice(at, next === -1 ? undefined : next);
}

const codes = (report: Report) => report.messages.map((m) => m.code);

describe("the summary table and the Messages section with a policy", { timeout: 60_000 }, () => {
  it("AC-17: without a policy the comment is the golden byte for byte; with one the table gains a Policy column and Messages leaves out the policy codes, and the P01 codes when a P01 is listed", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const goldenFiles = fixture("golden/files.txt").trim().split("\n");
    const run = (extra: Record<string, unknown>) => {
      const report = core.check({
        version: "0.1.0",
        coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
        diff: { text: fixture("golden/pr.diff") },
        repoRoot: REPO_ROOT,
        threshold: 80,
        repoFiles: goldenFiles,
        ...extra,
      });
      expectValidReport(report);
      return report;
    };
    const app = (document: unknown) => ({
      source: "app",
      version: 3,
      fetchedAt: "2026-10-26T12:00:00.000Z",
      document,
    });

    const golden = readFileSync(new URL("fixtures/golden/report.md", ROOT), "utf8");
    expect(core.renderMarkdown(run({}))).toBe(golden);

    // P08: CLAUDE.local.md tracked under a policy forbidding it.
    const p08Report = run({
      repoFiles: [...goldenFiles, "CLAUDE.local.md"],
      policy: app(JSON.parse(fixture("policy-rules/p08-violates/policy.json"))),
    });
    expect(codes(p08Report)).toContain("POLICY_P08");
    const p08Md = core.renderMarkdown(p08Report);
    const lines = p08Md.split("\n");
    const header = lines.indexOf(HEADER);
    expect(header).toBeGreaterThanOrEqual(0);
    expect(lines[header + 1]).toBe(SEPARATOR);
    const p08Messages = messagesSection(p08Md).join("\n");
    for (const code of POLICY_CODES) expect(p08Messages, code).not.toContain(`\`${code}\``);

    // P01: an empty inventory under a policy requiring agent setup.
    const noSetup = goldenFiles.filter((p) => !p.startsWith(".") && !/(^|\/)(AGENTS|CLAUDE)\.md$/.test(p));
    expect(noSetup).toEqual(["README.md", "src/math.ts", "src/new.ts", "src/utils/new-name.ts"]);
    const p01Report = run({
      repoFiles: noSetup,
      policy: app(JSON.parse(fixture("policy-rules/p01-violates/policy.json"))),
    });
    expect(p01Report.policy?.violations.some((v) => v.id === "P01")).toBe(true);
    expect(codes(p01Report)).toContain("NO_AGENT_SETUP_FILES");
    const p01Md = core.renderMarkdown(p01Report);
    expect(p01Md.split("\n")).toContain(HEADER);
    const p01Messages = messagesSection(p01Md).join("\n");
    for (const code of [...POLICY_CODES, ...P01_CODES]) expect(p01Messages, code).not.toContain(`\`${code}\``);

    // Every policy code at once: a file policy at a path the diff edits (P09), lowering P01 (POLICY_OVERRIDE_IGNORED).
    const document = JSON.parse(fixture("policy-rules/p01-violates/policy.json"));
    const fileReport = run({
      repoFiles: noSetup,
      policy: {
        source: "file",
        version: null,
        path: "src/math.ts",
        document: { ...document, policy: { rules: { P01: "warn" } } },
      },
    });
    for (const code of ["POLICY_P09", "POLICY_OVERRIDE_IGNORED", "NO_AGENT_SETUP_FILES"]) {
      expect(codes(fileReport), code).toContain(code);
    }
    const fileMessages = messagesSection(core.renderMarkdown(fileReport)).join("\n");
    for (const code of [...POLICY_CODES, ...P01_CODES]) expect(fileMessages, code).not.toContain(`\`${code}\``);

    // An unavailable policy: POLICY_UNAVAILABLE is in the report, not in the Messages section.
    const resolved = JSON.parse(fixture("policy-rules/p10-violates/resolved.json"));
    const unavailable = run({ policy: { ...resolved, unavailable: { reason: "timeout", required: false } } });
    expect(codes(unavailable)).toContain("POLICY_UNAVAILABLE");
    const unavailableMd = core.renderMarkdown(unavailable);
    expect(unavailableMd.split("\n")).toContain(HEADER);
    expect(messagesSection(unavailableMd).join("\n")).not.toContain("`POLICY_UNAVAILABLE`");
  });
});
