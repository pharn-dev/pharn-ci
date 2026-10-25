import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// check(), renderMarkdown(), readDiffChunks() and main() are loaded inside the test body: the AC tests are written
// before TI03 and TI04 exist, so nothing the build adds may run while the file loads.

const ROOT = new URL("../../../", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(`fixtures/${path}`, ROOT), "utf8");
const REPO_ROOT = "/home/runner/work/demo/demo";
const SHA = "1111111111111111111111111111111111111111";
const HEADING = "### 🔍 Test integrity";
const JS = "src/user.test.ts";
const E2E = "e2e/login.spec.ts";

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

/** An existing test skipped (TI03 block) in a file that also gains an `it.only` (TI04), and a conditional skip. */
const SKIPPED = edit(JS, [12, 12, ["it('creates a user', () => {"], ["it.skip('creates a user', () => {"]]);
const DIFF =
  edit(
    JS,
    [12, 12, ["it('creates a user', () => {"], ["it.skip('creates a user', () => {"]],
    [30, 30, [], ["it.only('a', () => {"]],
  ) + edit(E2E, [7, 7, [], ['  test.skip(isMobile, "x")']]);

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
        const paths = fixture("test-files-deleted/files.txt").trim().split("\n");
        return args.includes("-z") ? `${paths.join("\0")}\0` : `${paths.join("\n")}\n`;
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

describe("TI03 and TI04 in the PR comment, the streaming reader and the CLI", () => {
  it("AC-12: the section lists each signal with a hint, both message hints exist, streamed equals whole text, the CLI JSON holds TI03", async () => {
    const { check, renderMarkdown, readDiffChunks } = await import("@pharn-ci/core");

    const base = {
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
      testIntegrityMode: { input: "block" as const },
    };

    // The report from check(): TI03 block and warn, and TI04.
    const whole = check({ ...base, diff: { text: DIFF } } as Parameters<typeof check>[0]);
    expectValidReport(whole);
    const summary = whole.testIntegrity.signals.map((s) => `${s.id} ${s.severity} ${s.path}:${s.line}`);
    expect(summary).toEqual([`TI03 warn ${E2E}:7`, `TI03 block ${JS}:12`, `TI04 block ${JS}:30`]);

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
          { id: "TI03", severity: "warn", path: E2E, line: 7, detail: "detail-ti03-warn" },
          { id: "TI03", severity: "block", path: JS, line: 12, detail: "detail-ti03-block" },
          { id: "TI04", severity: "block", path: JS, line: 30, detail: "detail-ti04-block" },
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

    // The TI03 hint: a reviewer decision for a skipped test, such as one that fails in CI, which the accept label
    // will record; it does not name the label or its input.
    const ti03Hint = hints.get("TI03") ?? "";
    expect(ti03Hint).toMatch(/review/i);
    expect(ti03Hint).toMatch(/skip/i);
    expect(ti03Hint).toMatch(/fail/i);
    expect(ti03Hint).toMatch(/\bCI\b/);
    expect(ti03Hint).toMatch(/accept/i);
    expect(ti03Hint).toMatch(/label/i);
    // Superseded: when this test was written the label had not shipped, so the hint did not name `pharn/accepted`;
    // now it does, as the hint a reviewer who is not the PR author acts on (accept-label-human-signoff-4).
    expect(ti03Hint).toContain("`pharn/accepted`");
    expect(ti03Hint).not.toContain("accept-label");
    expect(hints.get("TI04")).not.toBe(ti03Hint);

    // The Messages section: a hint line under each of the two new codes.
    const all = renderMarkdown(whole).split("\n");
    for (const code of ["TEST_INTEGRITY_TI03", "TEST_INTEGRITY_TI04"]) {
      expect(whole.messages.filter((m) => (m.code as string) === code)).toHaveLength(1);
      const at = all.findIndex((line) => line.includes(`\`${code}\``));
      expect(at, code).toBeGreaterThan(-1);
      expect(all[at + 1]?.startsWith("  - Hint: "), code).toBe(true);
      // TI04's hint is unchanged and names no label; TI03's now names the default one (superseded, see above).
      if (code === "TEST_INTEGRITY_TI03") expect(all[at + 1], code).toContain("`pharn/accepted`");
      else expect(all[at + 1], code).not.toContain("pharn/accepted");
      expect(all[at + 1], code).not.toContain("accept-label");
    }

    // The CLI JSON on a diff that adds `it.skip` to an existing test holds the TI03 signal.
    const { main } = await import("../src/main.js");
    const repo = fakeRepo(SKIPPED);
    const code = await main(
      ["check", "--coverage", "coverage/lcov.info", "--format", "json", "--test-integrity", "block"],
      repo.deps as never,
    );
    expect(code).not.toBe(2);
    const report = JSON.parse(repo.stdout());
    expectValidReport(report);
    const signals = report.testIntegrity.signals as Array<{ id: string; path: string; severity: string; line: number }>;
    expect(signals.filter((s) => s.id === "TI03")).toEqual([
      expect.objectContaining({ id: "TI03", path: JS, severity: "block", line: 12 }),
    ]);
  });
});
