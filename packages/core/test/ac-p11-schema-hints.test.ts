import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-22. Reads the schema as text; check() and renderMarkdown() are loaded inside the test
// body: the AC test is written before the build adds the two codes, so nothing the build adds may run while this file
// loads. (CORE-132: the comparison of the code description and of report.v1.json with an old commit was a history pin
// and is removed; the description still names both codes.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const P11_HINT =
  "Agent PRs may not change these paths under the org policy. Move the change to a pull request by a person, or ask the policy owner to change `agents.protected_paths`.";
const INCOMPLETE_HINT =
  "Re-run the job if the GitHub API failed. A pull request with more than 250 commits, an author GitHub does not name, or an edited policy file whose base cannot be read always counts as an agent PR.";

const codeDescription = (schemaText: string): string =>
  (JSON.parse(schemaText) as { $defs: { message: { properties: { code: { description: string } } } } }).$defs.message
    .properties.code.description;

type Message = { level: string; code: string; text: string };
type Report = Record<string, unknown> & { messages: Message[] };
interface Core {
  check(input: unknown): Report;
  renderMarkdown(report: Report): string;
}

describe("the schema sentence and the hints for POLICY_P11 and AGENT_PR_DETECTION_INCOMPLETE", {
  timeout: 60_000,
}, () => {
  it("AC-22: report.v2.json names the two codes in its code description; reports with either code validate; the two hints are the fixed texts", async () => {
    const description = codeDescription(read("schema/report.v2.json"));
    expect(description).toContain(" POLICY_P11 (error, or warn when");
    expect(description).toContain(" AGENT_PR_DETECTION_INCOMPLETE (");

    // A report carrying both codes validates, and renders both hints.
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const report = core.check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: {
        text: [
          "diff --git a/src/a.ts b/src/a.ts",
          "index 1111111..2222222 100644",
          "--- a/src/a.ts",
          "+++ b/src/a.ts",
          "@@ -2,0 +3 @@",
          "+x",
          "",
        ].join("\n"),
      },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: null,
      repoFiles: ["AGENTS.md", "src/a.ts"],
      policy: {
        source: "app",
        version: 3,
        fetchedAt: "2026-10-26T12:00:00.000Z",
        document: { version: 1, agents: { protected_paths: ["src/**"] } },
      },
      agentPrFacts: { pr: { author: { login: "octocat", type: "User" }, labels: ["ai-generated"], commits: null } },
    });
    expectValidReport(report);
    const codes = report.messages.map((m) => m.code);
    expect(codes).toContain("POLICY_P11");
    expect(codes).toContain("AGENT_PR_DETECTION_INCOMPLETE");
    for (const code of ["POLICY_P11", "AGENT_PR_DETECTION_INCOMPLETE"]) {
      expectValidReport({ ...report, messages: report.messages.filter((m) => m.code === code) });
    }

    const markdown = core.renderMarkdown(report);
    expect(markdown).toContain(`  - Hint: ${P11_HINT}`);
    expect(markdown).toContain(`  - Hint: ${INCOMPLETE_HINT}`);
    const source = read("packages/core/src/render/markdown.ts");
    expect(source).toMatch(/^\s*POLICY_P11:\s*["'`]Agent PRs may not change these paths under the org policy\. /m);
    expect(source).toMatch(/^\s*AGENT_PR_DETECTION_INCOMPLETE:\s*["'`]Re-run the job if the GitHub API failed\. /m);
  });
});
