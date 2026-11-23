import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeRow } from "./codeTable.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-22. Reads the schema as text; check() and renderMarkdown() are loaded inside the test
// body: the AC test is written before the build adds the two codes, so nothing the build adds may run while this file
// loads. (CORE-132: the comparison of the code description and of report.v1.json with an old commit was a history pin
// and is removed. CORE-140: the code description became one sentence and a link to the code table of docs/output.md,
// so the codes and their levels are read from that table; the comment's hint is each code's fix.hint.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const P11_HINT =
  "Ask a person to review or make the change to the paths the org policy protects from agent pull requests.";
const INCOMPLETE_HINT = "Check that the token can read the pull request, its labels and its commits.";

type Message = { level: string; code: string; text: string };
type Report = Record<string, unknown> & { messages: Message[] };
interface Core {
  check(input: unknown): Report;
  renderMarkdown(report: Report): string;
}

describe("the schema sentence and the hints for POLICY_P11 and AGENT_PR_DETECTION_INCOMPLETE", {
  timeout: 60_000,
}, () => {
  it("AC-22: the code table documents the two codes with their levels; reports with either code validate; the two hints are the fixed texts", async () => {
    expect(codeRow("POLICY_P11")).toContain("(`error`; `warn` when");
    expect(codeRow("AGENT_PR_DETECTION_INCOMPLETE")).toContain("(`warn`)");

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
    // The hint is written once, in the fix table, and is also each message's fix.hint.
    const source = read("packages/core/src/fix/table.ts");
    expect(source).toContain(JSON.stringify(P11_HINT));
    expect(source).toContain(JSON.stringify(INCOMPLETE_HINT));
    for (const code of ["POLICY_P11", "AGENT_PR_DETECTION_INCOMPLETE"]) {
      const message = report.messages.find((m) => m.code === code) as Message & { fix?: { hint: string } };
      expect(markdown, code).toContain(`  - Hint: ${message.fix?.hint}`);
    }
  });
});
