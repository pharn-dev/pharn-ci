import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI10 exists, so nothing the build adds
// may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const REPO_FILES = ["package.json", "packages/api/package.json", "src/a.ts", "src/a.test.ts"];

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
const ti10 = (report: Report) => report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI10");
const ti10Messages = (report: Report) => report.messages.filter((m) => (m.code as string) === "TEST_INTEGRITY_TI10");

/** The AC-2 diffs, grouped by the weakening kind each one adds. */
type Kind = "or-true" | "echo" | "exit-0" | "pass-with-no-tests" | "path-filter" | "name-filter" | "hook-removed";
const VALUES: Array<[Kind, string]> = [
  ["or-true", "vitest run || true"],
  ["echo", "echo skipped"],
  ["echo", "vitest run; echo done"],
  ["echo", "vitest run || echo failed"],
  ["exit-0", "vitest run; exit 0"],
  ["pass-with-no-tests", "vitest run --passWithNoTests"],
  ["path-filter", "jest --testPathPattern=src/a"],
  ["name-filter", "vitest run -t adds"],
  ["name-filter", "jest --testNamePattern=adds"],
];
const AC2: Array<[Kind, string]> = [
  ...VALUES.map(([kind, value]): [Kind, string] => [
    kind,
    edit("package.json", [7, 7, ['    "test": "vitest run",'], [`    "test": "${value}",`]]),
  ]),
  ...VALUES.map(([kind, value]): [Kind, string] => [
    kind,
    edit("packages/api/package.json", [9, 9, ['    "test:unit": "vitest run",'], [`    "test:unit": "${value}",`]]),
  ]),
  ["hook-removed", edit("package.json", [5, 5, ['    "pretest": "pnpm lint",'], []])],
  ["hook-removed", edit("package.json", [8, 8, ['    "posttest": "pnpm audit",'], []])],
];

const TWO_KINDS = edit("package.json", [
  7,
  7,
  ['    "test": "vitest run",'],
  ['    "test": "vitest run --passWithNoTests || true",'],
]);
const TWENTY_ONE = edit("package.json", [
  10,
  10,
  [],
  Array.from({ length: 21 }, (_, i) => `    "test:p${i + 1}": "vitest || true",`),
]);

/** Text of the added and removed lines that must not reach a TI10 detail or message. */
function forbiddenText(diffs: string[]): string[] {
  const out = new Set<string>([
    "--passWithNoTests",
    "--testPathPattern",
    "--testNamePattern",
    "|| true",
    "||",
    "exit 0",
    "echo ",
    "vitest",
    "jest",
    "pnpm",
    "-t adds",
  ]);
  for (const diff of diffs) {
    for (const raw of diff.split("\n")) {
      if (!/^[+-]/.test(raw) || raw.startsWith("+++") || raw.startsWith("---")) continue;
      const line = raw.slice(1).trim();
      out.add(line);
      const pair = /^"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/.exec(line);
      if (pair === null) continue;
      const [, key, value] = pair as unknown as [string, string, string];
      out.add(`"${key}"`);
      if (key !== "test") out.add(key);
      out.add(value);
    }
  }
  return [...out];
}

describe("TI10: one signal per kind, the cap, and the fixed details", () => {
  it("AC-5: two kinds on one line give two signals, 21 weakened scripts give 20, and each of the seven kinds has its own fixed sentence with no line text", async () => {
    const both = ti10(await run(TWO_KINDS));
    expect(both.map((s) => `${s.path}:${s.line}`)).toEqual(["package.json:7", "package.json:7"]);
    expect(new Set(both.map((s) => s.detail)).size).toBe(2);

    const capped = await run(TWENTY_ONE);
    expect(ti10(capped).map((s) => s.line)).toEqual(Array.from({ length: 20 }, (_, i) => 10 + i));

    const texts: string[] = [];
    for (const report of [await run(TWO_KINDS), capped]) {
      texts.push(...ti10(report).map((s) => s.detail), ...ti10Messages(report).map((m) => m.text));
    }

    const byKind = new Map<Kind, Set<string>>();
    for (const [kind, diff] of AC2) {
      const report = await run(diff);
      const signals = ti10(report);
      expect(signals, `${kind}: ${diff}`).toHaveLength(1);
      const details = byKind.get(kind) ?? new Set<string>();
      for (const signal of signals) {
        details.add(signal.detail);
        texts.push(signal.detail);
      }
      byKind.set(kind, details);
      const messages = ti10Messages(report);
      expect(messages, `${kind}: ${diff}`).toHaveLength(1);
      texts.push(...messages.map((m) => m.text));
    }

    expect(byKind.size).toBe(7);
    for (const [kind, details] of byKind) {
      expect(details.size, kind).toBe(1);
      const [detail] = [...details] as [string];
      expect(detail.length, kind).toBeGreaterThan(0);
      expect(detail.length, kind).toBeLessThanOrEqual(300);
    }
    const sentences = [...byKind.values()].map((d) => [...d][0]);
    expect(new Set(sentences).size).toBe(7);

    // The 21 scripts all add `|| true`: every one of their details is the or-true sentence.
    const orTrue = [...(byKind.get("or-true") ?? [])][0];
    expect(new Set(ti10(capped).map((s) => s.detail))).toEqual(new Set([orTrue]));

    const forbidden = forbiddenText([TWO_KINDS, TWENTY_ONE, ...AC2.map(([, diff]) => diff)]);
    for (const text of texts) {
      for (const needle of forbidden) expect(text, `"${needle}" in: ${text}`).not.toContain(needle);
    }
  });
});
