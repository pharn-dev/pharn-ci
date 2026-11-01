import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// E3 item 23 (policy settings), AC-19. check(), renderMarkdown(), main() and nodeDeps() are loaded inside the test
// body: the AC test is written before the build adds policy mode, so nothing the build adds may run while this file
// loads. Every piece of file text that causes a violation or a problem carries a plain lower-case marker word; none
// may reach the report, the comment or the CLI's output, while the policy's own patterns do.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
interface Deps {
  git(args: string[]): Promise<string>;
  gitBatch?(args: string[], input: string): Promise<Uint8Array>;
  stdout(text: string): void;
  stderr(text: string): void;
}

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const GOLDEN_ROOT = "/home/runner/work/demo/demo";

const MARKERS = [
  "zebraallow",
  "yakdeny",
  "walrusserver",
  "vulturecmd",
  "urchinarg",
  "tapirurl",
  "slothenv",
  "ravenheader",
  "quokkahook",
  "pelicankey",
  "cmdserver",
  "argserver",
  "urlserver",
  "envserver",
];

const POLICY = {
  version: 1,
  setup: {
    forbidden_permissions: ["Bash(curl:*)"],
    required_permissions_deny: ["Bash(rm -rf:*)"],
    allowed_mcp_servers: ["github"],
    forbidden_mcp_servers: ["/usr/bin/*", "npx *", "https://*"],
    required_hooks: [{ event: "PreToolUse", matcher: "Write|Edit" }],
  },
};

const SETTINGS = [
  "{",
  '  "permissions": {',
  '    "allow": ["Bash(curl zebraallow)"],',
  '    "deny": ["Bash(yakdeny:*x)"]',
  "  },",
  '  "hooks": {',
  '    "PreToolUse": [',
  '      { "matcher": "Edit", "hooks": [{ "type": "command", "command": "./quokkahook.sh" }] }',
  "    ]",
  "  },",
  '  "pelicankey": 1,',
  '  "pelicankey": 2',
  "}",
  "",
].join("\n");

const MCP = [
  "{",
  '  "mcpServers": {',
  '    "walrusserver": { "command": "node" },',
  '    "cmdserver": { "command": "/usr/bin/vulturecmd" },',
  '    "argserver": { "command": "npx", "args": ["urchinarg"] },',
  '    "urlserver": { "url": "https://tapirurl.example/x" },',
  '    "envserver": { "command": "node", "env": { "MODE": "slothenv" }, "headers": { "X-Label": "ravenheader" } }',
  "  }",
  "}",
  "",
].join("\n");

function expectNoMarker(label: string, text: string) {
  for (const marker of MARKERS) expect(text.includes(marker), `${label} holds no ${marker}`).toBe(false);
}

/** The report must hold the violations and the problem the marked text causes, so the absence check is not vacuous. */
function expectCaused(label: string, report: Report) {
  const ids = new Set((report.policy?.violations ?? []).map((v) => v.id));
  for (const id of ["P02", "P03", "P04", "P05", "P06"]) expect(ids.has(id), `${label}: a ${id} violation`).toBe(true);
  expect(
    report.messages.some((m) => m.code === "POLICY_SETTINGS_INVALID"),
    `${label}: a POLICY_SETTINGS_INVALID message`,
  ).toBe(true);
  const json = JSON.stringify(report);
  for (const pattern of ["Bash(curl:*)", "/usr/bin/*", "npx *", "https://*"]) {
    expect(json.includes(pattern), `${label}: the policy's own pattern ${pattern} is shown`).toBe(true);
  }
}

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository whose base commit holds the agent settings, the MCP file and the policy, and a feature commit. */
function repo(): string {
  // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-polset-echo-")));
  dirs.push(dir);
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  put("src/math.ts", "export const a = 1;\nexport const b = 2;\n");
  put(".claude/settings.json", SETTINGS);
  put(".mcp.json", MCP);
  put("policy/org.json", `${JSON.stringify(POLICY, null, 2)}\n`);
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", "feature");
  put("src/math.ts", "export const a = 1;\nexport const b = 3;\nexport const c = 4;\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  put("coverage/lcov.info", `SF:${dir}/src/math.ts\nDA:1,1\nDA:2,1\nDA:3,1\nend_of_record\n`);
  return dir;
}

async function runCli(dir: string, format: string[]) {
  const { main } = await import("../src/main.js");
  const { nodeDeps } = await import("../src/nodeDeps.js");
  const deps = nodeDeps(dir) as unknown as Deps;
  let out = "";
  let err = "";
  deps.stdout = (text) => {
    out += text;
  };
  deps.stderr = (text) => {
    err += text;
  };
  const args = ["check", "--base", "main", "--coverage", "coverage/lcov.info", "--policy-file", "policy/org.json"];
  const code = await main([...args, ...format], deps as never);
  return { code, out, err };
}

describe("policy mode never echoes file text", () => {
  it("AC-19: no marker word of the settings, MCP or hook text reaches the report JSON, the comment or the CLI output, while the policy's own pattern text does", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as {
      check(input: unknown): Report;
      renderMarkdown(report: unknown): string;
    };
    const report = core.check({
      version: "0.1.0",
      coverage: { text: read("fixtures/golden/coverage.info"), format: "lcov" },
      diff: { text: read("fixtures/golden/pr.diff") },
      repoRoot: GOLDEN_ROOT,
      threshold: 80,
      repoFiles: [...read("fixtures/golden/files.txt").trim().split("\n"), ".claude/settings.json", ".mcp.json"],
      policy: { source: "file", version: null, path: "policy/org.json", document: POLICY },
      policySettingsSources: {
        files: [
          { path: ".claude/settings.json", text: SETTINGS },
          { path: ".mcp.json", text: MCP },
        ],
        dropped: [],
      },
    });
    expectValidReport(report);
    expectCaused("check()", report);
    expectNoMarker("the report JSON", JSON.stringify(report));
    expectNoMarker("the rendered comment", core.renderMarkdown(report));

    const dir = repo();
    const json = await runCli(dir, ["--format", "json"]);
    expect(json.code, json.err).toBe(1);
    const cliReport = JSON.parse(json.out) as Report;
    expectValidReport(cliReport);
    expectCaused("the CLI report", cliReport);
    expectNoMarker("the CLI JSON output", json.out);
    expectNoMarker("the CLI stderr (json)", json.err);

    const summary = await runCli(dir, []);
    expect(summary.code, summary.err).toBe(1);
    expect(summary.out).toContain("### 📜 Policy");
    expectNoMarker("the CLI summary", summary.out);
    expectNoMarker("the CLI stderr (summary)", summary.err);
  }, 120_000);
});
