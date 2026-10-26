import { describe, expect, it } from "vitest";
import { messagesOf, runDiff, signalsOf } from "./ac-e1-fix-shared.js";
import { expectValidReport } from "./schema.js";

// check() and acceptTestIntegrity() are loaded inside the test body: the AC test is written before TI15 caps its
// findings per change, so nothing the build adds may run while the file loads.

/** The signal id and every literal, built from parts so this file adds none of them as written. */
const ID = ["TI", "15"].join("");
const CODE = ["TEST_INTEGRITY_", ID].join("");
const j = (...parts: string[]) => parts.join("");
const MANY = "src/many.ts";
const OTHER = "src/other.ts";
const TEST = "src/many.test.ts";
const LABEL = "pharn/accepted";

/** A modified file that adds `lines` from line `at`. */
function addLines(path: string, at: number, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, `@@ -${at - 1},0 +${at},${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

describe("TI15: at most 10 findings per change", () => {
  it("AC-9: 25 matches in src/many.ts and 3 in src/other.ts give the first 10 by path, line and detail, a message ending with the not-listed counts, and the same message text after the accept-label downgrade", async () => {
    const values = Array.from({ length: 28 }, (_, i) => j("lit-value-", String(i + 1).padStart(2, "0")));
    const diff =
      addLines(
        TEST,
        8,
        values.map((v) => `  expect(f("${v}")).toBe(1);`),
      ) +
      addLines(
        MANY,
        10,
        values.slice(0, 25).map((v, i) => `  if (s === "${v}") return ${i};`),
      ) +
      addLines(
        OTHER,
        10,
        values.slice(25).map((v, i) => `  if (s === "${v}") return ${i};`),
      );
    const report = await runDiff(diff, "block");

    const signals = signalsOf(report, ID);
    expect(signals.map((s) => `${s.path}:${s.line}`)).toEqual(
      Array.from({ length: 10 }, (_, i) => `${MANY}:${10 + i}`),
    );
    for (const signal of signals) expect(signal.severity).toBe("warn");

    const messages = messagesOf(report, CODE);
    expect(messages).toHaveLength(1);
    const text = messages[0]?.text ?? "";
    expect(text.endsWith(` Not listed: 15 more in \`${MANY}\`, 3 more in \`${OTHER}\`.`), text).toBe(true);

    const { acceptTestIntegrity } = await import("../src/acceptLabel.js");
    const accepted = acceptTestIntegrity(report, { label: LABEL, by: "Reviewer-1" });
    expectValidReport(accepted);
    const after = messagesOf(accepted, CODE);
    expect(after).toHaveLength(1);
    expect(after[0]?.text, "the message text after the downgrade").toBe(text);
  });
});
