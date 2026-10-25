import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// check() and the renderer are loaded inside each test body: the AC tests are written before the Tests changed table
// exists, so nothing that depends on it may run while the file loads. The reports are built by check() over a small
// input with no test sources, and `testIntegrity.changes` is then set by hand, so every count is known here.

const REPO_ROOT = "/home/runner/work/demo/demo";
const SUMMARY = "<details><summary>Tests changed";

type Mode = "block" | "warn" | "off";
interface FileRow {
  path: string;
  language: string;
  added: unknown;
  removed: unknown;
  modified: unknown;
  renamed: unknown;
}
interface Changes {
  totals: { added: number; removed: number; modified: number; renamed: number };
  files: FileRow[];
  added: unknown[];
  removed: unknown[];
  modified: unknown[];
  renamed: unknown[];
}

async function baseReport(mode: Mode): Promise<{ testIntegrity: Record<string, unknown> }> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    testIntegrityMode: { input: mode },
  } as unknown as Parameters<typeof check>[0]);
  return structuredClone(report) as unknown as { testIntegrity: Record<string, unknown> };
}

/** `count` files `src/fNN.test.ts`, each with its own counts; totals sum them. */
function changesOf(count: number): Changes {
  const files: FileRow[] = Array.from({ length: count }, (_, i) => ({
    path: `src/f${String(i).padStart(2, "0")}.test.ts`,
    language: "ts",
    added: i % 4,
    removed: (i + 1) % 3,
    modified: 1,
    renamed: i % 2,
  }));
  const sum = (key: "added" | "removed" | "modified" | "renamed") => files.reduce((n, f) => n + (f[key] as number), 0);
  return {
    totals: { added: sum("added"), removed: sum("removed"), modified: sum("modified"), renamed: sum("renamed") },
    files,
    added: [],
    removed: [],
    modified: [],
    renamed: [],
  };
}

/** The lines of the collapsed Tests changed block, from its summary line to `</details>`, or [] when absent. */
function block(markdown: string): string[] {
  const lines = markdown.split("\n");
  const at = lines.findIndex((line) => line.startsWith(SUMMARY));
  if (at === -1) return [];
  const close = lines.findIndex((line, i) => i > at && line === "</details>");
  expect(close, "the block closes").toBeGreaterThan(at);
  return lines.slice(at, close + 1);
}

const fileRows = (lines: string[]) => lines.filter((line) => /^\| `[^`]+` \|/.test(line));

async function render(report: unknown, options?: { maxRows?: number }): Promise<string> {
  const { renderMarkdown } = await import("../src/render/markdown.js");
  return renderMarkdown(report as never, options as never);
}

describe("renderMarkdown(): the Tests changed table's row cap and guards", () => {
  it("AC-12: a summary of 60 files shows 50 rows, or 10 with maxRows 10, followed by the …and N more files row", async () => {
    const report = await baseReport("warn");
    const changes = changesOf(60);
    report.testIntegrity.changes = changes;

    for (const [options, shown] of [
      [undefined, 50],
      [{ maxRows: 10 }, 10],
    ] as const) {
      const lines = block(await render(report, options));
      expect(lines.length, "the Tests changed block is rendered").toBeGreaterThan(0);
      const rows = fileRows(lines);
      expect(rows).toHaveLength(shown);
      expect(rows.map((row) => /^\| `([^`]+)` \|/.exec(row)?.[1])).toEqual(
        changes.files.slice(0, shown).map((f) => f.path),
      );
      const first = changes.files[0] as FileRow;
      expect(rows[0]).toBe(
        `| \`${first.path}\` | ${first.added} | ${first.removed} | ${first.modified} | ${first.renamed} |`,
      );
      const after = lines.indexOf(rows.at(-1) as string) + 1;
      expect(lines[after]).toBe(`| _…and ${60 - shown} more files_ | | | | |`);
    }
  });

  it("AC-12: a count cell that is not a number renders as 0", async () => {
    const report = await baseReport("warn");
    const changes = changesOf(2);
    (changes.files[0] as FileRow).added = "<b>7</b>";
    (changes.files[1] as FileRow).renamed = null;
    report.testIntegrity.changes = changes;
    const lines = block(await render(report));
    const rows = fileRows(lines);
    expect(rows).toEqual([`| \`src/f00.test.ts\` | 0 | 1 | 1 | 0 |`, `| \`src/f01.test.ts\` | 1 | 2 | 1 | 0 |`]);
    expect(lines.join("\n")).not.toContain("<b>");
  });

  it("AC-12: a report with testIntegrity.changes in mode off, and a report without it, render no Tests changed summary", async () => {
    // Control: the same changes in mode warn render the summary.
    const warn = await baseReport("warn");
    warn.testIntegrity.changes = changesOf(3);
    expect(block(await render(warn)).length, "mode warn renders it").toBeGreaterThan(0);

    const off = await baseReport("off");
    off.testIntegrity.changes = changesOf(3);
    const offMarkdown = await render(off);
    expect(offMarkdown).not.toContain("Tests changed");

    const none = await baseReport("warn");
    expect("changes" in none.testIntegrity).toBe(false);
    expect(await render(none)).not.toContain("Tests changed");
  });
});
