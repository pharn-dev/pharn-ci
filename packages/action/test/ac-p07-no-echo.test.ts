import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { runGitBatch } from "../../node-io/src/io.js";
import { harness, PR_CONTEXT } from "./harness.js";

// E3 item 24 (P07), AC-19. check(), renderMarkdown() and run() are loaded inside the test body and
// fixtures/policy-rules/p07/sentinel/ is read there too: the AC test is written before the build adds rule P07 and its
// fixtures, so nothing the build adds may run while this file loads. The Action run uses the in-memory harness and a
// real temporary workspace that is a git repository committing the sentinel files as AGENTS.md and CLAUDE.md, read by
// a git batch runner.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const GOLDEN_ROOT = "/home/runner/work/demo/demo";
const POLICY_PATH = ".pharn/policy.json";
const SENTINEL = "SENTINEL-P07-7f3a";
const PATHS = ["AGENTS.md", "CLAUDE.md"];
const TRACKED = [...PATHS, POLICY_PATH, "README.md", "src/math.ts"];

/** The six tool words and the words of pharn-ci's fixed P07 sentences, lower-cased. */
const TOOL_WORDS = ["npm", "pnpm", "yarn", "bun", "vitest", "jest"];
const SENTENCES = [
  "package manager: here, in and other file files",
  "test runner:",
  "agent instruction files name a different package manager or test runner than another file in the same directory.",
  "agent instruction file names",
  "Each file's line is in the report's policy violations.",
  "of the violations are not listed in the report. of the violations is not listed in the report.",
  "agent instruction file was not compared: binary, too large, past the read caps, an unsafe path or not a file at HEAD.",
  "files were",
  "The agent instruction files were not read, so they were not compared.",
  "agent instruction files were not read; P07 did not compare them",
  "agent instruction file was not compared (binary, too large, past the read caps or an unsafe path)",
  "(not a file at HEAD)",
];
const FIXED = new Set([...TOOL_WORDS, ...SENTENCES.join(" ").toLowerCase().split(/\s+/).map(strip)]);

function strip(word: string): string {
  return word.replace(/^[`,.;:()]+|[`,.;:()]+$/g, "");
}

/** The words of `text` that are not a known path, a path:line, a number, a tool set or a fixed word. */
function strayWords(text: string): string[] {
  const stray: string[] = [];
  for (const raw of text.split(/\s+/)) {
    const word = strip(raw);
    if (word === "") continue;
    const located = /^(.+):(\d+)$/.exec(word);
    if (PATHS.includes(word) || (located !== null && PATHS.includes(located[1] as string))) continue;
    if (/^\d+$/.test(word)) continue;
    if (word.split("/").every((part) => TOOL_WORDS.includes(part))) continue;
    if (FIXED.has(word.toLowerCase())) continue;
    stray.push(word);
  }
  return stray;
}

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = Record<string, unknown> & { messages: Message[]; policy?: { violations: Violation[] } };
interface Core {
  check(input: unknown): Report;
  renderMarkdown(report: Report): string;
}

async function realReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

function expectNoSentinel(text: string, label: string) {
  expect(text.toLowerCase().includes(SENTINEL.toLowerCase()), label).toBe(false);
}

const p07 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P07");

/** Every P07 detail and the POLICY_P07 text hold only paths, numbers, tool words and fixed words. */
function expectOnlyFixedWords(report: Report, label: string) {
  const texts = [
    ...p07(report).map((v) => v.detail),
    ...report.messages.filter((m) => m.code === "POLICY_P07").map((m) => m.text),
  ];
  expect(texts.length, `${label}: P07 output`).toBeGreaterThan(0);
  for (const text of texts) expect(strayWords(text), `${label}: ${text}`).toEqual([]);
}

describe("P07 never echoes instruction file text", { timeout: 180_000 }, () => {
  it("AC-19: through check(), the renderer and the Action, the report, markdown, summary and logs never hold the sentinel, and every word of the P07 details and message is a path, a number, a tool word or a fixed word", async () => {
    const agents = read("fixtures/policy-rules/p07/sentinel/agents.txt");
    const claude = read("fixtures/policy-rules/p07/sentinel/claude.txt");
    // The fixtures hold the sentinel in prose, a code span and a shell block, and as a command word.
    for (const text of [agents, claude]) {
      expect(text).toContain(SENTINEL);
      expect(text).toContain(`\`${SENTINEL}`);
      expect(text).toContain(`${SENTINEL} install`);
      expect(text).toMatch(/```(sh|bash)\n/);
    }

    // check() and renderMarkdown().
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const report = core.check({
      version: "0.1.0",
      coverage: { text: read("fixtures/golden/coverage.info"), format: "lcov" },
      diff: { text: read("fixtures/diff/empty.diff") },
      repoRoot: GOLDEN_ROOT,
      threshold: null,
      repoFiles: TRACKED,
      policy: { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: { version: 1 } },
      agentInstructionSources: {
        files: [
          { path: "AGENTS.md", text: agents },
          { path: "CLAUDE.md", text: claude },
        ],
        dropped: [],
      },
    });
    expectValidReport(report);
    expect(p07(report).map((v) => v.path)).toEqual(PATHS);
    expectOnlyFixedWords(report, "check()");
    expectNoSentinel(JSON.stringify(report), "check() report");
    expectNoSentinel(core.renderMarkdown(report), "markdown");

    // The Action: local diff, file: policy.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-p07-no-echo-")));
    try {
      const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
      sh("init", "-q", "-b", "main");
      sh("config", "user.email", "test@example.com");
      sh("config", "user.name", "test");
      sh("config", "commit.gpgsign", "false");
      writeFileSync(join(dir, "AGENTS.md"), agents);
      writeFileSync(join(dir, "CLAUDE.md"), claude);
      mkdirSync(join(dir, ".pharn"), { recursive: true });
      writeFileSync(join(dir, POLICY_PATH), JSON.stringify({ version: 1 }));
      sh("add", "-A");
      sh("commit", "-q", "-m", "agent setup");
      mkdirSync(join(dir, "coverage"), { recursive: true });
      writeFileSync(
        join(dir, "coverage/lcov.info"),
        read("fixtures/golden/coverage.info").replaceAll(GOLDEN_ROOT, dir),
      );

      const { run } = await import("../src/run.js");
      const context = {
        ...PR_CONTEXT,
        workflow: "ci",
        job: "check",
        runId: 9,
        runAttempt: 1,
        actor: "octocat",
        payload: {
          repository: { full_name: "acme/widgets", id: 42 },
          pull_request: {
            number: 7,
            base: { sha: "a".repeat(40) },
            head: { sha: "b".repeat(40) },
            user: { login: "octocat", type: "User" },
            labels: [],
            commits: 1,
          },
        },
      };
      const h = harness({ context: context as never, inputs: { policy: `file:${POLICY_PATH}` }, lsFiles: TRACKED });
      h.deps.api = {
        ...h.deps.api,
        async listPullRequestCommits() {
          return { commits: [], hasNext: false };
        },
      } as typeof h.deps.api;
      Object.assign(h.deps, {
        workspace: dir,
        readFile: realReadFile,
        gitBatch: (args: string[], input: string) => runGitBatch(dir, args, input),
      });
      await run(h.deps);
      const text = h.written[h.outputs["report-path"] ?? ""];
      if (text === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(h.failed)}`);
      const actionReport = JSON.parse(text) as Report;
      expectValidReport(actionReport);
      expect(p07(actionReport).map((v) => v.path)).toEqual(PATHS);
      expectOnlyFixedWords(actionReport, "the Action");

      expectNoSentinel(text, "report.json");
      expectNoSentinel(h.summary.join("\n"), "job summary");
      expectNoSentinel(h.posted.join("\n"), "PR comment");
      expectNoSentinel(h.infos.join("\n"), "info logs");
      expectNoSentinel(h.warnings.join("\n"), "warnings");
      expectNoSentinel(h.failed.join("\n"), "failure message");
      for (const [name, value] of Object.entries(h.outputs)) expectNoSentinel(value, `output ${name}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
