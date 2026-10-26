import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the size cap are loaded inside the test body: the AC test is written before TI03 reads aliases, so
// nothing the build adds may run while the file loads. The hostile text is generated here. Its first line binds `pt`
// to pytest, so the added `@pt.mark.skip` must give one block TI03, which only the build makes true; the hostile part
// below it binds nothing to `pt`. Each size is run once to warm up, then timed three times; the medians are compared.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "py/test_cart.py";
const SLOW = 300_000;

/** The test file's first lines: the binding, the decorator added at line 4, and the test it decorates. */
const PREFIX = [
  "import pytest as pt",
  "",
  "",
  "@pt.mark.skip",
  "def test_total():",
  "    assert total([2, 3]) == 5",
  "",
];
const DECORATOR_LINE = 4;

/** The hostile part, about `size` UTF-16 code units: unclosed groups, many pytest aliases, unbalanced quotes and parens. */
function hostile(size: number): string {
  const third = Math.floor(size / 3);
  /** Lines from `next(n)` for n = 0, 1, … until they hold `third` code units with their newlines. */
  const fill = (next: (n: number) => string): string[] => {
    const out: string[] = [];
    let length = 0;
    for (let n = 0; length < third; n++) {
      const line = next(n);
      out.push(line);
      length += line.length + 1;
    }
    return out;
  };
  const groups = fill((n) => (n % 2 === 0 ? "from pytest import (" : `    mark as g${n},`));
  const aliases = fill((n) => `import pytest as p${n}`);
  const shapes = ['"', "'", "(", "((", ")", '"""', "'''x", 'x = "', "[", "from pytest import (mark as q,"];
  const unbalanced = fill((n) => shapes[n % shapes.length] as string);
  return [...groups, ...aliases, ...unbalanced].join("\n");
}

/** Head and base texts whose head is at most `limit` UTF-16 code units (all ASCII, so as many bytes). */
function texts(limit: number): { head: string; base: string } {
  const prefix = `${PREFIX.join("\n")}\n`;
  let head = `${prefix}${hostile(limit - prefix.length - 64)}\n`;
  if (head.length > limit) head = `${head.slice(0, limit - 1)}\n`;
  const lines = head.split("\n");
  lines.splice(DECORATOR_LINE - 1, 1);
  return { head, base: lines.join("\n") };
}

const DIFF = `${[
  `diff --git a/${PATH} b/${PATH}`,
  "index 1111111..2222222 100644",
  `--- a/${PATH}`,
  `+++ b/${PATH}`,
  `@@ -${DECORATOR_LINE - 1},0 +${DECORATOR_LINE} @@`,
  "+@pt.mark.skip",
].join("\n")}\n`;

async function runOnce(
  head: string,
  base: string,
): Promise<{ ms: number; signals: { id: string; severity: string; path: string; line: number | null }[] }> {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: DIFF },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [PATH, "src/cart.ts"],
    testIntegrityMode: { input: "block" },
    testSources: {
      base: { files: [{ path: PATH, text: base }], dropped: [] },
      head: { files: [{ path: PATH, text: head }], dropped: [] },
    },
  } as unknown as Parameters<typeof check>[0];
  const started = performance.now();
  const report = check(input);
  const ms = performance.now() - started;
  expectValidReport(report);
  const signals = (
    report as unknown as {
      testIntegrity: { signals: { id: string; severity: string; path: string; line: number | null }[] };
    }
  ).testIntegrity.signals
    .filter((s) => String(s.id) === "TI03")
    .map((s) => ({ id: String(s.id), severity: s.severity, path: s.path, line: s.line }));
  return { ms, signals };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

describe("TI03's alias reader on hostile text near the test-source size cap", () => {
  it(
    "AC-7: a hostile Python test file just under MAX_TEST_SOURCE_FILE_BYTES returns without throwing, validates, gives the block TI03 of its resolvable alias, and takes less than 8 times a quarter-size one (median of three)",
    async () => {
      const core = (await import("@pharn-ci/core")) as unknown as { MAX_TEST_SOURCE_FILE_BYTES: number };
      const cap = core.MAX_TEST_SOURCE_FILE_BYTES;
      expect(cap).toBe(524288);

      const full = texts(cap - 1);
      const quarter = texts(Math.floor(cap / 4));
      expect(Buffer.byteLength(full.head, "utf8"), "the full-size text is under the cap").toBeLessThan(cap);
      expect(Buffer.byteLength(full.head, "utf8"), "the full-size text is near the cap").toBeGreaterThan(cap - 1024);
      expect(
        full.head.split("\n").filter((l) => /^import pytest as p\d+$/.test(l)).length,
        "thousands of aliases",
      ).toBeGreaterThan(2000);
      expect(
        full.head.split("\n").filter((l) => l === "from pytest import (").length,
        "unclosed groups",
      ).toBeGreaterThan(1000);

      const expected = [{ id: "TI03", severity: "block", path: PATH, line: DECORATOR_LINE }];
      for (const [label, t] of [
        ["full", full],
        ["quarter", quarter],
      ] as const) {
        const warm = await runOnce(t.head, t.base);
        expect(warm.signals, `${label}: one block TI03 for @pt.mark.skip`).toEqual(expected);
      }

      const times = { full: [] as number[], quarter: [] as number[] };
      for (let i = 0; i < 3; i++) {
        times.quarter.push((await runOnce(quarter.head, quarter.base)).ms);
        times.full.push((await runOnce(full.head, full.base)).ms);
      }
      const ratio = median(times.full) / Math.max(median(times.quarter), 1);
      expect(
        ratio,
        `full ${median(times.full).toFixed(1)} ms vs quarter ${median(times.quarter).toFixed(1)} ms`,
      ).toBeLessThan(8);
    },
    SLOW,
  );
});
