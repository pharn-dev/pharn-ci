import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI13 exists, so nothing the build adds
// may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const REPO_FILES = ["package.json", "src/a.ts", "src/a.test.ts", "src/b.ts", "src/b.mts", "lib/e.js", "tools/run.py"];

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

/** A file the diff adds (status added). */
function addFile(path: string, lines: string[]): string {
  const head = [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..2222222",
    "--- /dev/null",
    `+++ b/${path}`,
  ];
  return `${[...head, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

async function run(diff: string) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: REPO_FILES,
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

type Report = Awaited<ReturnType<typeof run>>;
const ti13 = (report: Report) => report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI13");
const ti13Messages = (report: Report) => report.messages.filter((m) => (m.code as string) === "TEST_INTEGRITY_TI13");

type Family = "istanbul" | "v8" | "c8" | "pragma";

/** The AC-6 diffs, grouped by marker family. */
const AC6: Array<[Family, string]> = [
  ...(
    [
      ["istanbul", "src/a.ts", "/* istanbul ignore next */"],
      ["istanbul", "src/a.ts", "// istanbul ignore next"],
      ["istanbul", "src/a.ts", "/* istanbul ignore else */"],
      ["istanbul", "src/a.ts", "export default /* istanbul ignore next */ function f() {}"],
      ["v8", "src/b.mts", "/* v8 ignore next 3 */"],
      ["v8", "src/c.jsx", "/* v8 ignore start */"],
      ["c8", "lib/d.cts", "/* c8 ignore stop */"],
      ["c8", "lib/e.js", "// c8 ignore next"],
      ["pragma", "tools/run.py", "    return x  # pragma: no cover"],
      ["pragma", "tools/run.py", "if DEBUG:  # pragma: no cover"],
      ["pragma", "tools/run.py", "#pragma:no cover"],
    ] as Array<[Family, string, string]>
  ).map(([family, path, line]): [Family, string] => [family, edit(path, [12, 12, [], [line]])]),
  ["istanbul", addFile("src/new.ts", ["/* istanbul ignore next */", "export function f() {", "  return 1;", "}"])],
];

const MARKER = "/* istanbul ignore next */";
const ONE_REMOVED_TWO_ADDED = edit("src/a.ts", [5, 5, [MARKER], []], [11, 10, [], [MARKER]], [20, 20, [], [MARKER]]);
const TWENTY_ONE = edit("src/b.ts", [10, 10, [], Array.from({ length: 21 }, () => "/* v8 ignore next */")]);

/** Comment text from the added and removed lines that must not reach a TI13 detail or message. */
function forbiddenText(diffs: string[]): string[] {
  const out = new Set<string>([
    "istanbul ignore",
    "v8 ignore",
    "c8 ignore",
    "ignore next",
    "ignore else",
    "ignore start",
    "ignore stop",
    "pragma: no cover",
    "pragma:no cover",
    "no cover",
    "/*",
    "*/",
    "DEBUG",
    "function f",
  ]);
  for (const diff of diffs) {
    for (const raw of diff.split("\n")) {
      if (!/^[+-]/.test(raw) || raw.startsWith("+++") || raw.startsWith("---")) continue;
      const line = raw.slice(1).trim();
      if (line.length >= 6) out.add(line);
    }
  }
  return [...out];
}

describe("TI13: one-to-one matching, the cap, and the fixed details", () => {
  it("AC-8: one removed and two added markers give one signal at the higher line, 21 give 20, and each of the four families has its own fixed sentence with no comment text", async () => {
    const moved = await run(ONE_REMOVED_TWO_ADDED);
    expect(ti13(moved).map((s) => `${s.path}:${s.line}`)).toEqual(["src/a.ts:20"]);

    const capped = await run(TWENTY_ONE);
    expect(ti13(capped).map((s) => `${s.path}:${s.line}`)).toEqual(
      Array.from({ length: 20 }, (_, i) => `src/b.ts:${10 + i}`),
    );

    const texts: string[] = [];
    for (const report of [moved, capped]) {
      texts.push(...ti13(report).map((s) => s.detail), ...ti13Messages(report).map((m) => m.text));
    }

    const byFamily = new Map<Family, Set<string>>();
    for (const [family, diff] of AC6) {
      const report = await run(diff);
      const signals = ti13(report);
      expect(signals, `${family}: ${diff}`).toHaveLength(1);
      const details = byFamily.get(family) ?? new Set<string>();
      for (const signal of signals) {
        details.add(signal.detail);
        texts.push(signal.detail);
      }
      byFamily.set(family, details);
      const messages = ti13Messages(report);
      expect(messages, `${family}: ${diff}`).toHaveLength(1);
      texts.push(...messages.map((m) => m.text));
    }

    expect(byFamily.size).toBe(4);
    for (const [family, details] of byFamily) {
      expect(details.size, family).toBe(1);
      const [detail] = [...details] as [string];
      expect(detail.length, family).toBeGreaterThan(0);
      expect(detail.length, family).toBeLessThanOrEqual(300);
    }
    const sentences = [...byFamily.values()].map((d) => [...d][0]);
    expect(new Set(sentences).size).toBe(4);

    // The 21 markers are all v8 ones, the one left of the move an istanbul one.
    const v8 = [...(byFamily.get("v8") ?? [])][0];
    expect(new Set(ti13(capped).map((s) => s.detail))).toEqual(new Set([v8]));
    const istanbul = [...(byFamily.get("istanbul") ?? [])][0];
    expect(ti13(moved).map((s) => s.detail)).toEqual([istanbul]);

    const forbidden = forbiddenText([ONE_REMOVED_TWO_ADDED, TWENTY_ONE, ...AC6.map(([, diff]) => diff)]);
    for (const text of texts) {
      for (const needle of forbidden) expect(text, `"${needle}" in: ${text}`).not.toContain(needle);
    }
  });
});
