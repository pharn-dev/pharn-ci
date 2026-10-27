import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings), AC-12. check() is loaded inside the test body: the AC test is written before the build
// adds the settings rules, so nothing the build adds may run while this file loads. Each case is its own settings
// unit (a `.claude/` directory), and every unit but the case's one requirement satisfies the other two.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";
const DOCUMENT = {
  version: 1,
  setup: {
    required_hooks: [
      { event: "PreToolUse", matcher: "Write|Edit" },
      { event: "PostToolUse", matcher: "Notebook.*" },
      { event: "Stop" },
    ],
  },
};

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const order = (a: Violation, b: Violation) =>
  cmp(a.id, b.id) ||
  (a.path === b.path ? 0 : a.path === null ? -1 : b.path === null ? 1 : cmp(a.path, b.path)) ||
  (a.line === b.line ? 0 : a.line === null ? -1 : b.line === null ? 1 : a.line - b.line) ||
  cmp(a.detail, b.detail);

type Handler = Record<string, unknown>;
type Group = { matcher?: string; hooks: Handler[] };
const CMD: Handler = { type: "command", command: "./check.sh" };
const PRE: Group = { matcher: "Write|Edit", hooks: [CMD] };
const POST: Group = { matcher: "Notebook.*", hooks: [CMD] };
const STOP: Group = { hooks: [CMD] };

const settings = (hooks: { pre?: Group; post?: Group; stop?: Group }, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify(
    {
      ...extra,
      hooks: { PreToolUse: [hooks.pre ?? PRE], PostToolUse: [hooks.post ?? POST], Stop: [hooks.stop ?? STOP] },
    },
    null,
    2,
  )}\n`;
const at = (path: string) => `${path}/.claude/settings.json`;

describe("org policy rule P06: required hook missing", { timeout: 60_000 }, () => {
  it("AC-12: missing, subset, different-regex, non-command and if hooks are P06 blocks with line null; universal, superset, equal-regex and Stop groups satisfy; disableAllHooks is one block at its line instead", async () => {
    const files: Record<string, string> = {
      ".claude/settings.json": settings({}),
      [at("missing")]: "{}\n",
      [at("omitted")]: settings({ pre: { hooks: [CMD] } }),
      [at("empty")]: settings({ pre: { matcher: "", hooks: [CMD] } }),
      [at("star")]: settings({ pre: { matcher: "*", hooks: [CMD] } }),
      [at("superset")]: settings({ pre: { matcher: "Edit|Write|Bash", hooks: [CMD] } }),
      [at("subset")]: settings({ pre: { matcher: "Edit", hooks: [CMD] } }),
      [at("regex")]: settings({ post: { matcher: "Notebook.+", hooks: [CMD] } }),
      [at("http")]: settings({ pre: { ...PRE, hooks: [{ type: "http", url: "https://example.com/hook" }] } }),
      [at("prompt")]: settings({ pre: { ...PRE, hooks: [{ type: "prompt", prompt: "check the edit" }] } }),
      [at("agent")]: settings({ pre: { ...PRE, hooks: [{ type: "agent", prompt: "review the edit" }] } }),
      [at("mcptool")]: settings({ pre: { ...PRE, hooks: [{ type: "mcp_tool", server: "s", tool: "t" }] } }),
      [at("iffy")]: settings({ pre: { ...PRE, hooks: [{ ...CMD, if: "Bash(git *)" }] } }),
    };
    const disabledText = settings({}, { disableAllHooks: true });
    files[at("disabled")] = disabledText;
    const disabledLine = disabledText.split("\n").findIndex((l) => l.includes('"disableAllHooks"')) + 1;
    expect(disabledLine).toBeGreaterThan(0);

    const { check } = await import("@pharn-ci/core");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("diff/empty.diff") },
      repoRoot: REPO_ROOT,
      threshold: null,
      repoFiles: ["AGENTS.md", "src/a.ts", ...Object.keys(files)],
      policy: { source: "file", version: null, path: "policy/org.json", document: DOCUMENT },
      policySettingsSources: { files: Object.entries(files).map(([path, text]) => ({ path, text })), dropped: [] },
    } as never);
    expectValidReport(report);
    const p06 = ((report as unknown as Report).policy?.violations ?? []).filter((v) => v.id === "P06");

    const missing = (unit: string, what: string): Violation => ({
      id: "P06",
      severity: "block",
      path: at(unit),
      line: null,
      detail: `required hook ${what} is missing`,
    });
    const PRE_MISSING = "PreToolUse Write|Edit";
    const expected: Violation[] = [
      missing("missing", PRE_MISSING),
      missing("missing", "PostToolUse Notebook.*"),
      missing("missing", "Stop (any tool)"),
      missing("subset", PRE_MISSING),
      missing("regex", "PostToolUse Notebook.*"),
      missing("http", PRE_MISSING),
      missing("prompt", PRE_MISSING),
      missing("agent", PRE_MISSING),
      missing("mcptool", PRE_MISSING),
      missing("iffy", PRE_MISSING),
      {
        id: "P06",
        severity: "block",
        path: at("disabled"),
        line: disabledLine,
        detail: "disableAllHooks turns every hook off",
      },
    ].sort(order);
    expect(p06).toEqual(expected);
    for (const unit of ["omitted", "empty", "star", "superset"]) {
      expect(
        p06.filter((v) => v.path === at(unit)),
        `${unit} satisfies the PreToolUse requirement`,
      ).toEqual([]);
    }
    expect(
      p06.filter((v) => v.path === ".claude/settings.json"),
      "the root unit satisfies all three",
    ).toEqual([]);
  });
});
