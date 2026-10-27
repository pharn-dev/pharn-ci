import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings), AC-7. check() is loaded inside the test body: the AC test is written before the build
// adds the settings rules, so nothing the build adds may run while this file loads. The settings text is built here
// and passed as policySettingsSources, as the CLI and the Action will pass the committed blobs.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";

async function run(document: unknown, files: Record<string, string>): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts", ...Object.keys(files)],
    policy: { source: "file", version: null, path: "policy/org.json", document },
    policySettingsSources: { files: Object.entries(files).map(([path, text]) => ({ path, text })), dropped: [] },
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

/** The text of `lines` joined with LF, and the 1-based line of the first line holding `needle`. */
function doc(lines: string[]) {
  return {
    text: `${lines.join("\n")}\n`,
    at(needle: string): number {
      const i = lines.findIndex((l) => l.includes(needle));
      if (i === -1) throw new Error(`no line holds ${needle}`);
      return i + 1;
    },
  };
}

const PATH = ".claude/settings.json";
const PREFIX = "allow rule overlaps forbidden permission ";

describe("org policy rule P02: forbidden permission allowed", { timeout: 60_000 }, () => {
  it("AC-7: broader, equal and inside allow entries each give one P02 block at their line naming the first overlapping forbidden entry; inert, partial-overlap, unrelated and ask entries give none; deny excuses nothing", async () => {
    const document = {
      version: 1,
      setup: { forbidden_permissions: ["Bash(rm -rf:*)", "Bash(curl:*)", "WebFetch", "Bash(rm:*)"] },
    };
    const settings = doc([
      "{",
      '  "permissions": {',
      '    "allow": [',
      '      "Bash",',
      '      "Bash(curl:*)",',
      '      "WebFetch(domain:x.com)",',
      '      "Bash(rm -rf /tmp)",',
      '      "Write(//etc/**)",',
      '      "Bash(* --force)",',
      '      "Bash(ls)"',
      "    ],",
      '    "ask": ["Bash(rm -rf:*)"],',
      '    "deny": ["Bash"]',
      "  }",
      "}",
    ]);
    const report = await run(document, { [PATH]: settings.text });
    const block = (needle: string, detail: string): Violation => ({
      id: "P02",
      severity: "block",
      path: PATH,
      line: settings.at(needle),
      detail: PREFIX + detail,
    });
    const p02 = (report.policy?.violations ?? []).filter((v) => v.id === "P02");
    expect(p02).toEqual([
      block('"Bash",', "Bash(rm -rf:*) and 2 more"),
      block('"Bash(curl:*)",', "Bash(curl:*)"),
      block('"WebFetch(domain:x.com)"', "WebFetch"),
      block('"Bash(rm -rf /tmp)"', "Bash(rm -rf:*) and 1 more"),
    ]);
    for (const quiet of ["Write(//etc/**)", "Bash(* --force)", '"Bash(ls)"', '"ask"', '"deny"']) {
      expect(
        p02.some((v) => v.line === settings.at(quiet)),
        `no P02 violation at the ${quiet} line`,
      ).toBe(false);
    }
    const messages = report.messages.filter((m) => m.code === "POLICY_P02");
    expect(messages.map((m) => m.level)).toEqual(["error"]);
    expect(report.verdict).toBe("fail");
  });
});
