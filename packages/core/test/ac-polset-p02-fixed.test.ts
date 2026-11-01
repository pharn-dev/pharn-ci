import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings), AC-8. check() is loaded inside the test body: the AC test is written before the build
// adds the settings rules, so nothing the build adds may run while this file loads.

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

const mode = (value: string) => doc(["{", '  "permissions": {', '    "defaultMode":', `      "${value}"`, "  }", "}"]);

describe("org policy rule P02: the fixed checks", { timeout: 60_000 }, () => {
  it("AC-8: defaultMode bypassPermissions and auto are P02 blocks at the value's line, a non-empty additionalDirectories is a P02 warn at the key's line, and default, acceptEdits and [] give none", async () => {
    const bypass = mode("bypassPermissions");
    const auto = mode("auto");
    const dirs = doc([
      "{",
      '  "permissions": {',
      '    "additionalDirectories": [',
      '      "../shared"',
      "    ]",
      "  }",
      "}",
    ]);
    expect(bypass.at('"defaultMode"'), "control: the key and the value are on different lines").not.toBe(
      bypass.at("bypassPermissions"),
    );
    expect(dirs.at('"additionalDirectories"')).not.toBe(dirs.at("../shared"));

    const files = {
      ".claude/settings.json": bypass.text,
      "a/.claude/settings.json": auto.text,
      "b/.claude/settings.json": mode("default").text,
      "c/.claude/settings.local.json": mode("acceptEdits").text,
      "d/.claude/settings.json": dirs.text,
      "e/.claude/settings.json": '{ "permissions": { "additionalDirectories": [] } }\n',
    };
    const report = await run({ version: 1 }, files);
    const p02 = (report.policy?.violations ?? []).filter((v) => v.id === "P02");
    expect(p02).toEqual([
      {
        id: "P02",
        severity: "block",
        path: ".claude/settings.json",
        line: bypass.at("bypassPermissions"),
        detail: "defaultMode bypassPermissions turns permission prompts off",
      },
      {
        id: "P02",
        severity: "block",
        path: "a/.claude/settings.json",
        line: auto.at('"auto"'),
        detail: "defaultMode auto lets a classifier approve actions",
      },
      {
        id: "P02",
        severity: "warn",
        path: "d/.claude/settings.json",
        line: dirs.at('"additionalDirectories"'),
        detail: "additionalDirectories gives the agent file access outside the repository",
      },
    ]);
    expect(report.messages.filter((m) => m.code === "POLICY_P02").map((m) => m.level)).toEqual(["error"]);
  });
});
