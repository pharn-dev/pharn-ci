import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// check(), renderMarkdown() and main() are loaded inside the test body: the AC tests are written before TI08, TI15
// and TI16 exist, so nothing the build adds may run while the file loads.

const ROOT = new URL("../../../", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(`fixtures/${path}`, ROOT), "utf8");
const REPO_ROOT = "/home/runner/work/demo/demo";
const SHA = "1111111111111111111111111111111111111111";
const HEADING = "### 🔍 Test integrity";
const REPO_FILES = ["package.json", "src/a.ts", "src/a.test.ts", "src/discount.ts", "src/discount.test.ts"];

/** Ids, codes, the literal and the marker, built from parts so this file holds none of them as written. */
const j = (...parts: string[]) => parts.join("");
const TI08 = j("TI", "08");
const TI15 = j("TI", "15");
const TI16 = j("TI", "16");
const IDS = [TI08, TI15, TI16];
const code = (id: string) => j("TEST_INTEGRITY_", id);
const SUMMER = j("SUMMER", "2024");
const SUPPRESSION = `  ${j("/", "/")} ${j("eslint", "-disable-next-line")} no-console`;

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

const add = (path: string, lines: string[]) => edit(path, [12, 12, [], lines]);
const SNAPSHOTS = Array.from({ length: 11 }, (_, i) =>
  edit(`src/__snapshots__/view-${String(i + 1).padStart(2, "0")}.ts.snap`, [
    3,
    3,
    ['exports[`view renders 1`] = `"old"`;'],
    ['exports[`view renders 1`] = `"new"`;'],
  ]),
).join("");
const SUPPRESSED = add("src/a.test.ts", [SUPPRESSION]);
/** TI08 (11 snapshot files), TI15 (a matching test and source literal) and TI16 (a test suppression). */
const DIFF =
  SNAPSHOTS +
  add("src/discount.test.ts", [`  expect(price("${SUMMER}")).toBe(0);`]) +
  add("src/discount.ts", [`  if (code === "${SUMMER}") return 0;`]) +
  SUPPRESSED;

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

describe("TI08, TI15 and TI16 in the PR comment and the CLI", () => {
  it("AC-13: the section lists each signal with its location, detail and a hint, the three message hints exist without an accept label, the empty report keeps its line, the CLI JSON holds TI16, and every report is valid", async () => {
    const { check, renderMarkdown } = await import("@pharn-ci/core");
    const base = {
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: REPO_FILES,
      testIntegrityMode: { input: "block" as const },
    };

    // The report from check() carries one signal of each of the three ids.
    const whole = check({ ...base, diff: { text: DIFF } } as Parameters<typeof check>[0]);
    expectValidReport(whole);
    for (const id of IDS) {
      expect(
        whole.testIntegrity.signals.filter((s) => String(s.id) === id),
        id,
      ).toHaveLength(1);
    }
    const ti08 = whole.testIntegrity.signals.find((s) => String(s.id) === TI08);
    expect(ti08?.line).toBeNull();

    // Plain details stand in for the fixed sentences, so each detail is found as written whatever the renderer escapes.
    const synthetic = {
      ...whole,
      testIntegrity: {
        ...whole.testIntegrity,
        signals: [
          { id: TI08, severity: "warn", path: "src/__snapshots__/view-01.ts.snap", line: null, detail: "detail-ti08" },
          { id: TI15, severity: "warn", path: "src/discount.ts", line: 12, detail: "detail-ti15" },
          { id: TI16, severity: "info", path: "src/a.test.ts", line: 12, detail: "detail-ti16" },
        ],
      },
    } as typeof whole;
    expectValidReport(synthetic);
    const lines = section(renderMarkdown(synthetic));
    const hints = new Map<string, string>();
    for (const signal of synthetic.testIntegrity.signals) {
      const location = signal.line === null ? `\`${signal.path}\`` : `\`${signal.path}:${signal.line}\``;
      const at = lines.findIndex((line) => line.includes(location) && line.includes(`**${signal.id}**`));
      expect(at, location).toBeGreaterThan(-1);
      expect(lines[at], location).toContain(signal.detail);
      if (signal.line === null) expect(lines[at], location).not.toContain(`\`${signal.path}:`);
      const hint = lines[at + 1] ?? "";
      expect(hint.startsWith("  - Hint: "), `${location}: ${hint}`).toBe(true);
      expect(hint.length, location).toBeGreaterThan("  - Hint: ".length);
      expect(hint, location).not.toMatch(/accept/i);
      hints.set(String(signal.id), hint);
    }
    expect(new Set(hints.values()).size).toBe(3);

    // A report carrying the three messages and no signal renders each code in Messages with its hint, and no hint
    // names an accept label.
    const messaged = {
      ...whole,
      testIntegrity: { ...whole.testIntegrity, signals: [] },
      messages: [
        ...whole.messages.filter((m) => !IDS.map(code).includes(String(m.code))),
        { level: "warn", code: code(TI08), text: "message-ti08" },
        { level: "warn", code: code(TI15), text: "message-ti15" },
        { level: "info", code: code(TI16), text: "message-ti16" },
      ],
    } as unknown as typeof whole;
    expectValidReport(messaged);
    const all = renderMarkdown(messaged).split("\n");
    for (const id of IDS) {
      const at = all.findIndex((line) => line.includes(`\`${code(id)}\``));
      expect(at, code(id)).toBeGreaterThan(-1);
      const hint = all[at + 1] ?? "";
      expect(hint.startsWith("  - Hint: "), `${code(id)}: ${hint}`).toBe(true);
      expect(hint, code(id)).not.toMatch(/accept/i);
    }

    // A report with no signal keeps the empty-state line.
    const empty = check({ ...base, diff: { text: add("src/a.ts", ["export const a = 2;"]) } } as Parameters<
      typeof check
    >[0]);
    expectValidReport(empty);
    expect(empty.testIntegrity.signals).toEqual([]);
    expect(section(renderMarkdown(empty))).toEqual([HEADING, "", "No test-integrity findings (mode: block).", ""]);

    // The CLI JSON on a diff that adds a test suppression holds the TI16 signal.
    const { main } = await import("../src/main.js");
    const repo = fakeRepo(SUPPRESSED);
    const exit = await main(
      ["check", "--coverage", "coverage/lcov.info", "--format", "json", "--test-integrity", "block"],
      repo.deps as never,
    );
    expect(exit).not.toBe(2);
    const report = JSON.parse(repo.stdout());
    expectValidReport(report);
    const signals = report.testIntegrity.signals as Array<{ id: string; path: string; severity: string; line: number }>;
    expect(signals.filter((s) => s.id === TI16)).toEqual([
      expect.objectContaining({ id: TI16, path: "src/a.test.ts", severity: "info", line: 12 }),
    ]);
  });
});
