import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// E3 item 24a part B (P11), AC-18. main() and check() are loaded inside the test body: the AC test is written before
// the build adds rule P11, so nothing the build adds may run while this file loads. The CLI reads a real temporary
// repository (the --policy-file reader lstats every path segment); git stays a fake that serves the diff. The same
// policy through check() with an agent's facts is the control: it shows the policy would block an agent PR, so the
// CLI's clean report means the CLI gathers no pull request facts, not that the policy protects nothing.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const GOLDEN_ROOT = "/home/runner/work/demo/demo";
const POLICY_PATH = "policy/org.json";
const POLICY = {
  version: 1,
  agents: { labels: ["bot-pr"], extra_logins: ["acme-agent"], protected_paths: ["src/**"] },
};
const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -2,0 +3 @@",
  "+x",
  "",
].join("\n");

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = Record<string, unknown> & {
  messages: Message[];
  policy?: { violations: Violation[] };
  meta?: Record<string, unknown>;
};

async function realReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

const p11 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P11");

describe("the CLI never sets the agent flag", { timeout: 60_000 }, () => {
  it("AC-18: check --policy-file with protected paths, an agent label and login gives no P11 violation, no POLICY_P11 or incomplete message and no isAgentPr, while the same policy blocks an agent PR in check()", async () => {
    // Control: the policy protects src/a.ts for an agent PR.
    const { check } = await import("@pharn-ci/core");
    const control = check({
      version: "0.1.0",
      coverage: { text: read("fixtures/golden/coverage.info"), format: "lcov" },
      diff: { text: DIFF },
      repoRoot: GOLDEN_ROOT,
      threshold: null,
      repoFiles: ["AGENTS.md", "src/a.ts"],
      policy: { source: "file", version: null, path: POLICY_PATH, document: POLICY },
      agentPrFacts: { pr: { author: { login: "acme-agent", type: "User" }, labels: [], commits: [] } },
    } as never) as unknown as Report;
    expect(p11(control).map((v) => v.path)).toEqual(["src/a.ts"]);

    const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-p11-cli-")));
    try {
      mkdirSync(join(dir, "coverage"), { recursive: true });
      writeFileSync(
        join(dir, "coverage/lcov.info"),
        read("fixtures/golden/coverage.info").replaceAll(GOLDEN_ROOT, dir),
      );
      mkdirSync(join(dir, "policy"), { recursive: true });
      writeFileSync(join(dir, POLICY_PATH), JSON.stringify(POLICY));

      const { main } = await import("../src/main.js");
      const out: string[] = [];
      const err: string[] = [];
      const tracked = ["AGENTS.md", POLICY_PATH, "src/a.ts"];
      const deps = {
        cwd: dir,
        git: async (args: string[]) => {
          if (args.includes("ls-files"))
            return args.includes("-z") ? `${tracked.join("\0")}\0` : `${tracked.join("\n")}\n`;
          if (args.includes("--show-toplevel")) return `${dir}\n`;
          if (args[0] === "ls-tree") return "";
          if (args.includes("diff")) return DIFF;
          return "1111111111111111111111111111111111111111\n";
        },
        readFile: realReadFile,
        resolvePath: (...segments: string[]) => resolve(...segments),
        stdout: (text: string) => {
          out.push(text);
        },
        stderr: (text: string) => {
          err.push(text);
        },
      };
      await main(
        ["check", "--coverage", "coverage/lcov.info", "--policy-file", POLICY_PATH, "--format", "json"],
        deps as never,
      );
      const stdout = out.join("");
      expect(stdout, `stderr: ${err.join("")}`).not.toBe("");
      const report = JSON.parse(stdout) as Report;
      expectValidReport(report);
      expect(report.policy, "the policy file was applied").toBeDefined();
      expect(p11(report)).toEqual([]);
      const codes = report.messages.map((m) => m.code);
      expect(codes).not.toContain("POLICY_P11");
      expect(codes).not.toContain("AGENT_PR_DETECTION_INCOMPLETE");
      expect(stdout).not.toContain("isAgentPr");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
