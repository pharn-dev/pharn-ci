import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-22. Reads the schemas as text, and at the base commit with git; check() and
// renderMarkdown() are loaded inside the test body: the AC test is written before the build adds the two codes, so
// nothing the build adds may run while this file loads. The base is 93376a9 (E3 item 22, main when this was written).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "93376a9";
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const atCommit = (commit: string, path: string) =>
  execFileSync("git", ["show", `${commit}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const P11_HINT =
  "Agent PRs may not change these paths under the org policy. Move the change to a pull request by a person, or ask the policy owner to change `agents.protected_paths`.";
const INCOMPLETE_HINT =
  "Re-run the job if the GitHub API failed. A pull request with more than 250 commits, an author GitHub does not name, or an edited policy file whose base cannot be read always counts as an agent PR.";

/** The upper-case code words of a text (as the pyparity2 pin collects them). */
const words = (text: string) =>
  [...new Set([...text.matchAll(/\b(?:TI\d\d|[A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/g)].map((m) => m[0]))].sort();

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
  it("AC-22: report.v2.json appends exactly one sentence naming the two codes and changes no other byte; report.v1.json is unchanged; reports with either code validate; the two hints are the fixed texts", async () => {
    // report.v2.json: the code description is the base one plus the one appended sentence; nothing else changes.
    const baseText = atCommit(BASE, "schema/report.v2.json");
    const nowText = read("schema/report.v2.json");
    const base = codeDescription(baseText);
    const now = codeDescription(nowText);
    expect(now.startsWith(base)).toBe(true);
    // Re-pinned for E3 item 23 (policy settings): item 23's sentence (POLICY_P02 to POLICY_P06 and
    // POLICY_SETTINGS_INVALID) follows this one, and E3 item 24 (P07)'s after it. They are set aside here;
    // ac-polrules-docs and ac-upload-schema pin them exactly.
    const all = now.slice(base.length);
    const item23 = all.indexOf(" POLICY_P02, POLICY_P03, POLICY_P04, POLICY_P05 and POLICY_P06 (");
    expect(item23, "item 23's sentence follows the P11 one").toBeGreaterThan(0);
    const appended = all.slice(0, item23);
    expect(appended.startsWith(" POLICY_P11 (error, or warn when"), appended).toBe(true);
    expect(appended.endsWith("names the reason as one fixed word)."), appended).toBe(true);
    expect(words(appended)).toEqual(["AGENT_PR_DETECTION_INCOMPLETE", "POLICY_P11"]);
    const encode = (s: string) => JSON.stringify(s).slice(1, -1);
    expect(baseText.split(encode(base))).toHaveLength(2);
    expect(nowText).toBe(baseText.replace(encode(base), () => encode(now)));

    // report.v1.json: byte-identical to the base commit.
    expect(read("schema/report.v1.json")).toBe(atCommit(BASE, "schema/report.v1.json"));

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
