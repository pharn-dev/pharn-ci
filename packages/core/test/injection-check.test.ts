import { describe, expect, it } from "vitest";
import { check, MAX_ADDED_TEXT_CHARS, MAX_ADDED_TEXT_LINES, type Report, readDiffChunks } from "../src/index.js";
import { fixture } from "./helpers.js";
import { addedFileDiff, injectionFixture } from "./injection-fixture.js";
import { expectValidReport } from "./schema.js";
import { withoutFix } from "./v090-codes.js";

// H4 through check(): the optional `injection` object and the INJECTION_ messages, PI01's block failing the verdict,
// the streamed and whole-text diff giving the same result, the cut-scan warning, and no trace of the scan on a clean
// change or without a diff. Every report validates against schema/report.v2.json.

const REPO_ROOT = "/home/runner/work/demo/demo";

function run(diff: Parameters<typeof check>[0]["diff"], over: Record<string, unknown> = {}): Report {
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff,
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts"],
    ...over,
  } as never);
  expectValidReport(report);
  return report;
}

const codes = (report: Report) => report.messages.map((m) => m.code).filter((c) => c.startsWith("INJECTION_"));

async function* chunksOf(text: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

// The cap tests build diffs of 50,001 lines and of 8,000,000 characters; under coverage instrumentation on a CI runner
// they take longer than the 5 s default, so the hang ceiling is raised (no timing is asserted).
describe("the prompt-injection scan in check()", { timeout: 120_000 }, () => {
  it("fails the check on a Trojan Source sample: PI01 blocks, with an error message naming paths and lines", () => {
    const report = run({ text: injectionFixture("trojan-source.diff.txt") });
    expect(report.verdict).toBe("fail");
    // fix-hints (H6): every message and finding now carries a `fix`; the pinned literals are unchanged, so they are read without it.
    expect(withoutFix(report.injection)).toEqual({
      signals: [
        {
          id: "PI01",
          severity: "block",
          path: "src/access.js",
          line: 4,
          detail: "right-to-left override U+202E and 3 more",
        },
        {
          id: "PI01",
          severity: "block",
          path: "src/commenting-out.js",
          line: 4,
          detail: "right-to-left override U+202E and 3 more",
        },
      ],
    });
    const message = withoutFix(report.messages.find((m) => m.code === "INJECTION_PI01"));
    expect(message).toEqual({
      level: "error",
      code: "INJECTION_PI01",
      text: "This change adds invisible or bidirectional Unicode characters, which can hide text from a reviewer or reorder what an agent reads (PI01): `src/access.js` line 4, `src/commenting-out.js` line 4.",
    });
  });

  it("warns on a published injection sample: PI02 and PI03 are warnings, one message per signal", () => {
    const report = run({ text: injectionFixture("literature-sample.diff.txt") });
    expect(report.verdict).not.toBe("pass");
    expect(withoutFix(report.messages.filter((m) => m.code.startsWith("INJECTION_")))).toEqual([
      {
        level: "warn",
        code: "INJECTION_PI02",
        text: "This change adds hidden Markdown text (an HTML comment, a link title or a reference definition) that addresses an agent (PI02): `docs/translate.md` line 7.",
      },
      {
        level: "warn",
        code: "INJECTION_PI03",
        text: "This change adds known prompt-injection phrases (PI03): `docs/translate.md` line 5, `src/summarize.py` line 2.",
      },
    ]);
    // No file text reaches the report: the planted payload words are nowhere in it.
    const json = JSON.stringify(report);
    for (const word of ["pwned", "hate humans", "French"]) expect(json).not.toContain(word);
  });

  it("names PI05 files without a line", () => {
    const report = run({ text: injectionFixture("pi05-trigger.diff.txt") });
    const message = report.messages.find((m) => m.code === "INJECTION_PI05");
    expect(message?.text).toBe(
      "This change adds agent instruction files inside a vendored directory, where an agent may read them as instructions (PI05): `node_modules/left-pad/CLAUDE.md`, `packages/web/dist/GEMINI.md`, `third_party/lib/.cursor/rules/setup.mdc`, `vendor/github.com/acme/kit/AGENTS.md`.",
    );
  });

  it("adds nothing for clean changes: no injection key and no INJECTION_ message", () => {
    for (const name of [
      "rtl-arabic.diff.txt",
      "rtl-hebrew.diff.txt",
      "persian-zwnj.diff.txt",
      "emoji-zwj.diff.txt",
      "pi02-clean.diff.txt",
      "pi03-clean.diff.txt",
      "pi04-clean.diff.txt",
      "pi05-clean.diff.txt",
    ]) {
      const report = run({ text: injectionFixture(name) });
      expect(Object.keys(report), name).not.toContain("injection");
      expect(codes(report), name).toEqual([]);
    }
  });

  it("adds nothing without a diff", () => {
    const report = run({ unavailable: "no base" });
    expect(report.injection).toBeUndefined();
    expect(codes(report)).toEqual([]);
  });

  it("gives the same findings and messages for a streamed diff and the whole text", async () => {
    for (const name of ["trojan-source.diff.txt", "literature-sample.diff.txt", "pi01-trigger.diff.txt"]) {
      const text = injectionFixture(name);
      const parsed = await readDiffChunks(chunksOf(text, 7));
      const streamed = run({ parsed });
      const whole = run({ text });
      expect(streamed.injection, name).toEqual(whole.injection);
      expect(streamed.messages, name).toEqual(whole.messages);
    }
  });

  it("puts the INJECTION_ messages after the agent config secret messages and before the policy messages", () => {
    const report = run(
      { text: injectionFixture("trojan-source.diff.txt") },
      {
        agentConfigSources: { unavailable: "no git" },
        policy: { source: "none", version: null, document: null, unavailable: { reason: "network", required: false } },
      },
    );
    const order = report.messages.map((m) => m.code);
    const secret = order.indexOf("AGENT_CONFIG_SECRET_UNSCANNED");
    const pi01 = order.indexOf("INJECTION_PI01");
    const policy = order.indexOf("POLICY_UNAVAILABLE");
    expect(secret).toBeGreaterThan(-1);
    expect(secret).toBeLessThan(pi01);
    expect(pi01).toBeLessThan(policy);
  });

  it("warns when a file has more added lines than the scan reads", () => {
    const lines = Array.from({ length: MAX_ADDED_TEXT_LINES + 1 }, (_, i) => `line ${i}`);
    const report = run({ text: addedFileDiff("docs/huge.md", lines) });
    const message = withoutFix(report.messages.find((m) => m.code === "INJECTION_TEXT_TRUNCATED"));
    expect(message).toEqual({
      level: "warn",
      code: "INJECTION_TEXT_TRUNCATED",
      text: `This change is too large to scan in full for hidden instructions: the content scan reads the first ${MAX_ADDED_TEXT_LINES} added lines of a file and ${MAX_ADDED_TEXT_CHARS} characters of added text in all, so a finding past them is not seen in \`docs/huge.md\`.`,
    });
    expect(report.injection).toBeUndefined();
  });

  it("warns for every file past the diff-wide character budget, and still finds what came before it", () => {
    const zwsp = String.fromCharCode(0x200b);
    const diff =
      addedFileDiff("a.md", [`early${zwsp}`]) +
      addedFileDiff("b.txt", ["x".repeat(MAX_ADDED_TEXT_CHARS)]) +
      addedFileDiff("c.md", [`late${zwsp}`]);
    const report = run({ text: diff });
    expect(report.injection?.signals.map((s) => s.path)).toEqual(["a.md"]);
    expect(report.messages.find((m) => m.code === "INJECTION_TEXT_TRUNCATED")?.text).toContain("`b.txt`, `c.md`.");
  });
});
