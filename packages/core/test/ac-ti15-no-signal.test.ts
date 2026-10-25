import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// check() is loaded inside the test body (through runDiff): the AC tests are written before TI15 exists, so nothing
// the build adds may run while the file loads.

/** The signal id, and every literal below, built from parts so this file adds none of them as written. */
const ID = ["TI", "15"].join("");
const j = (...parts: string[]) => parts.join("");

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

/** `lines` added at line `at` of a modified file. */
const add = (path: string, at: number, lines: string[]) => edit(path, [at, at, [], lines]);

const SUMMER = j("SUMMER", "2024");
const SUMMER_MIXED = j("Summer", "2024");
const GOLD = j("gold", "-tier");
const FLAG = j("feature", "-flag");
const ABC = j("a", "bc");
const TWELVE = j("1", "2");
const FIVE_HUNDREDTHS = j("0.0", "5");
const STOP = [j("Er", "ror"), j("utf", "-8"), j("DEL", "ETE"), j("def", "ault")];
const TEMPLATE = j("pre-", "${", "id}");

const TEST = "src/discount.test.ts";
const SOURCE = "src/discount.ts";

/** Control: the test adds the literal and the source compares against it with ===. */
const CONTROL =
  add(TEST, 8, [`  expect(price("${SUMMER}")).toBe(0);`]) + add(SOURCE, 12, [`  if (code === "${SUMMER}") return 0;`]);

const CASES: Array<[label: string, diff: string]> = [
  [
    "a case line whose literal is also on a removed line of the source (a moved case)",
    add("src/tier.test.ts", 8, [`  expect(rank('${GOLD}')).toBe(1);`]) +
      edit("src/tier.ts", [10, 10, [`    case '${GOLD}':`], []], [20, 19, [], [`    case '${GOLD}':`]]),
  ],
  [
    "the source reads a key the test sets, with no comparison",
    add("src/flags.test.ts", 8, [`  config["${FLAG}"] = true;`]) +
      add("src/flags.ts", 12, [`  const on = config["${FLAG}"];`]),
  ],
  [
    "a three-character string",
    add(TEST, 8, [`  expect(price("${ABC}")).toBe(0);`]) + add(SOURCE, 12, [`  if (code === "${ABC}") return 0;`]),
  ],
  [
    "numbers of fewer than three significant digits",
    add(TEST, 8, [`  expect(price(${TWELVE}, ${FIVE_HUNDREDTHS})).toBe(0);`]) +
      add(SOURCE, 12, [`  if (n === ${TWELVE}) return 0;`, `  if (rate === ${FIVE_HUNDREDTHS}) return 1;`]),
  ],
  [
    "stop-list literals in any case",
    add(
      TEST,
      8,
      STOP.map((s) => `  expect(kind("${s}")).toBe(1);`),
    ) +
      add(SOURCE, 12, [
        `  if (kind === "${STOP[0]}") return 1;`,
        `  if (enc === "${STOP[1]}") return 2;`,
        `  if (method === "${STOP[2]}") return 3;`,
        `    case "${STOP[3]}":`,
      ]),
  ],
  [
    "the comparison added only in a test file",
    add(TEST, 8, [`  expect(price("${SUMMER}")).toBe(0);`, `  if (code === "${SUMMER}") skip();`]),
  ],
  [
    "the test literal only on a removed line",
    edit(TEST, [8, 8, [`  expect(price("${SUMMER}")).toBe(0);`], []]) +
      add(SOURCE, 12, [`  if (code === "${SUMMER}") return 0;`]),
  ],
  [
    "a template literal holding ${",
    add(TEST, 8, [`  expect(price(\`${TEMPLATE}\`)).toBe(0);`]) +
      add(SOURCE, 12, [`  if (code === \`${TEMPLATE}\`) return 0;`]),
  ],
  [
    "the source compares a literal that differs from the test's in case",
    add(TEST, 8, [`  expect(price("${SUMMER}")).toBe(0);`]) +
      add(SOURCE, 12, [`  if (code === "${SUMMER_MIXED}") return 0;`]),
  ],
  [
    "the comparison added in a Go source file",
    add(TEST, 8, [`  expect(price("${SUMMER}")).toBe(0);`]) +
      add("pkg/discount.go", 12, [`	if code == "${SUMMER}" {`]),
  ],
];

describe("TI15: literals and lines that give no special-casing signal", () => {
  it("AC-8: a moved case, a read without comparison, short literals and numbers, the stop-list, test-only comparisons, removed test literals, template literals, a case difference and Go give no TI15", async () => {
    const control = signalsOf(await runDiff(CONTROL), ID);
    expect(control.map((s) => `${s.path}:${s.line}`)).toEqual([`${SOURCE}:12`]);

    for (const [label, diff] of CASES) {
      expect(signalsOf(await runDiff(diff), ID), label).toEqual([]);
    }
  });
});
