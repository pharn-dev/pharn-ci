import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// check(), renderMarkdown(), readDiffChunks() and main() are loaded inside the test body: the AC tests are written
// before TI10 and TI13 exist, so nothing the build adds may run while the file loads.

const ROOT = new URL("../../../", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(`fixtures/${path}`, ROOT), "utf8");
const REPO_ROOT = "/home/runner/work/demo/demo";
const SHA = "1111111111111111111111111111111111111111";
const HEADING = "### 🔍 Test integrity";
const REPO_FILES = ["package.json", "src/a.ts", "src/a.test.ts", "test/helpers.ts"];

/** One hunk of a `--unified=0` diff: the first old and new line of the change, the removed and the added lines. */
type Hunk = [oldStart: number, newStart: number, removed: string[], added: string[]];

function hunk([oldStart, newStart, removed, added]: Hunk): string[] {
  const oldPart = removed.length === 0 ? `${oldStart - 1},0` : `${oldStart},${removed.length}`;
  const newPart = added.length === 0 ? `${newStart - 1},0` : `${newStart},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

function edit(path: string, ...hunks: Hunk[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap((h) => hunk(h))].join("\n")}\n`;
}

async function* chunksOf(text: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

/** `|| true` added to the existing test script. */
const OR_TRUE = edit("package.json", [7, 7, ['    "test": "vitest run",'], ['    "test": "vitest run || true",']]);
/** The AC-9 diff: the istanbul hint added to a source file, and `|| true` added to the test script. */
const DIFF = edit("src/a.ts", [12, 12, [], ["/* istanbul ignore next */"]]) + OR_TRUE;

/** The lines of the Test integrity section: from its heading to the line before the next `### ` heading. */
function section(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(HEADING);
  if (start === -1) throw new Error("no Test integrity heading");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("### "));
  return [HEADING, ...(end === -1 ? rest : rest.slice(0, end))];
}

function fakeRepo(diff: string) {
  const out: string[] = [];
  const err: string[] = [];
  const contents = new Map([[resolve(REPO_ROOT, "coverage/lcov.info"), fixture("test-files-deleted/coverage.info")]]);
  const deps = {
    cwd: REPO_ROOT,
    git: async (args: string[]) => {
      if (args.includes("ls-files")) {
        return args.includes("-z") ? `${REPO_FILES.join("\0")}\0` : `${REPO_FILES.join("\n")}\n`;
      }
      if (args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
      if (args.includes("diff")) return diff;
      return `${SHA}\n`;
    },
    readFile: async (path: string) => contents.get(path) ?? null,
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
  };
  return { deps, stdout: () => out.join("") };
}

describe("TI10 and TI13 in the PR comment, the streaming reader and the CLI", () => {
  it("AC-10: the section lists each signal with a hint, both message hints exist, streamed equals whole text, the CLI JSON holds TI10", async () => {
    const { check, renderMarkdown, readDiffChunks } = await import("@pharn-ci/core");

    const base = {
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: REPO_FILES,
      testIntegrityMode: { input: "block" as const },
    };

    // The report from check(): one TI10 and one TI13 signal.
    const whole = check({ ...base, diff: { text: DIFF } } as Parameters<typeof check>[0]);
    expectValidReport(whole);
    const summary = whole.testIntegrity.signals.map((s) => `${s.id} ${s.severity} ${s.path}:${s.line}`);
    expect(summary).toEqual(["TI10 block package.json:7", "TI13 block src/a.ts:12"]);

    // The same diff through the streaming reader in chunks of 7 characters.
    const parsed = await readDiffChunks(chunksOf(DIFF, 7));
    const streamed = check({ ...base, diff: { parsed } } as Parameters<typeof check>[0]);
    expectValidReport(streamed);
    expect(streamed.testIntegrity).toEqual(whole.testIntegrity);
    expect(streamed.messages).toEqual(whole.messages);

    // The Test integrity section: id in bold, `path:line` in a code span, the detail, an indented hint line. Plain
    // details stand in for the fixed sentences, so the detail is found as written whatever the renderer escapes.
    const synthetic = {
      ...whole,
      testIntegrity: {
        ...whole.testIntegrity,
        signals: [
          { id: "TI10", severity: "block", path: "package.json", line: 7, detail: "detail-ti10-block" },
          { id: "TI13", severity: "block", path: "src/a.ts", line: 12, detail: "detail-ti13-block" },
        ],
      },
    } as typeof whole;
    expectValidReport(synthetic);
    const lines = section(renderMarkdown(synthetic));
    const hints = new Map<string, string>();
    for (const signal of synthetic.testIntegrity.signals) {
      const location = `\`${signal.path}:${signal.line}\``;
      const at = lines.findIndex((line) => line.includes(location) && line.includes(`**${signal.id}**`));
      expect(at, location).toBeGreaterThan(-1);
      expect(lines[at], location).toContain(signal.detail);
      const hint = lines[at + 1] ?? "";
      expect(hint.startsWith("  - Hint: "), location).toBe(true);
      hints.set(String(signal.id), hint);
    }
    expect(hints.size).toBe(2);

    // The TI10 hint: restore the script or state the reason in the PR. The TI13 hint: a test in place of the ignore
    // comment. Both say a reviewer who is not the PR author records the sign-off by applying the accept label, and
    // name it. Superseded: when this test was written the label had not shipped, so the hints said it "will record"
    // the sign-off "once it ships" and did not name `pharn/accepted`; now it ships and the hints name it
    // (accept-label-human-signoff-4, ac-accept-signoff-hints.test.ts).
    const ti10Hint = hints.get("TI10") ?? "";
    expect(ti10Hint).toMatch(/restore/i);
    expect(ti10Hint).toMatch(/script/i);
    expect(ti10Hint).toMatch(/\bPR\b/);
    const ti13Hint = hints.get("TI13") ?? "";
    expect(ti13Hint).toMatch(/\btest\b/i);
    expect(ti13Hint).toMatch(/ignore comment/i);
    for (const hint of [ti10Hint, ti13Hint]) {
      expect(hint).toMatch(/accept label/i);
      expect(hint).toMatch(/review/i);
      expect(hint).toMatch(/sign-?off/i);
      expect(hint).toMatch(/not the PR author/i);
      expect(hint).toContain("`pharn/accepted`");
      expect(hint).not.toMatch(/ships/i);
      expect(hint).not.toContain("accept-label");
    }
    expect(ti13Hint).not.toBe(ti10Hint);

    // The comment-layout change leaves a signal's message out of the Messages section when the Test integrity section
    // lists that signal (its finding and hint are above), so the comment names each code once. A report carrying the
    // message without the signal (another producer's) still renders it, with its hint.
    const listed = renderMarkdown(whole);
    const all = renderMarkdown({ ...whole, testIntegrity: { ...whole.testIntegrity, signals: [] } }).split("\n");
    for (const code of ["TEST_INTEGRITY_TI10", "TEST_INTEGRITY_TI13"]) {
      expect(whole.messages.filter((m) => (m.code as string) === code)).toHaveLength(1);
      expect(listed, code).not.toContain(`\`${code}\``);
      const at = all.findIndex((line) => line.includes(`\`${code}\``));
      expect(at, code).toBeGreaterThan(-1);
      expect(all[at + 1]?.startsWith("  - Hint: "), code).toBe(true);
      // Superseded (see above): the message hints name the default label too.
      expect(all[at + 1], code).toContain("`pharn/accepted`");
      expect(all[at + 1], code).not.toContain("accept-label");
    }

    // The CLI JSON on a diff that adds `|| true` to the test script holds the TI10 signal.
    const { main } = await import("../src/main.js");
    const repo = fakeRepo(OR_TRUE);
    const code = await main(
      ["check", "--coverage", "coverage/lcov.info", "--format", "json", "--test-integrity", "block"],
      repo.deps as never,
    );
    expect(code).not.toBe(2);
    const report = JSON.parse(repo.stdout());
    expectValidReport(report);
    const signals = report.testIntegrity.signals as Array<{ id: string; path: string; severity: string; line: number }>;
    expect(signals.filter((s) => s.id === "TI10")).toEqual([
      expect.objectContaining({ id: "TI10", path: "package.json", severity: "block", line: 7 }),
    ]);
  });
});
