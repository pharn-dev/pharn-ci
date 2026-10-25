import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";
import { expectValidReport } from "./schema.js";

// A literal TI15 matches can be a secret (`if (key === "<token>")`), and the report leaves the job, so its detail names
// the literal's kind and length only. The token-shaped value is built from parts here, not committed as a fixture file:
// a fixture holding it as written would also trip the repository's secret scanning.

const ID = ["TI", "15"].join("");
const TOKEN = ["sk", "live", "abcdefghijklmnop"].join("_");

/** A modified file that adds `lines` from line `at`. */
function addLines(path: string, at: number, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, `@@ -${at - 1},0 +${at},${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

describe("TI15: a token-shaped literal never reaches the report", () => {
  it("AC-17: a detail for a matched token-shaped literal holds no substring of it of 4 or more characters, and nothing in the report or comment does", async () => {
    const diff =
      addLines("src/auth.test.ts", 8, [`  expect(allowed("${TOKEN}")).toBe(true);`]) +
      addLines("src/auth.ts", 12, [`  if (key === "${TOKEN}") return true;`]);
    const report = await runDiff(diff);
    expectValidReport(report);

    const signals = signalsOf(report, ID);
    expect(signals).toHaveLength(1);
    const detail = signals[0]?.detail ?? "";
    expect(detail).toContain(`a ${TOKEN.length}-character string literal`);
    expect(detail).toContain('"src/auth.ts:12"');
    expect(detail).toContain('"src/auth.test.ts"');

    const { renderMarkdown } = await import("../src/render/markdown.js");
    const everywhere = [detail, JSON.stringify(report), renderMarkdown(report)];
    for (let start = 0; start + 4 <= TOKEN.length; start++) {
      const piece = TOKEN.slice(start, start + 4);
      for (const text of everywhere) expect(text.includes(piece), `"${piece}" leaked`).toBe(false);
    }
  });
});
