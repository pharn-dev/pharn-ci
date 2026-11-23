import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-69. check(), unavailableTestSources() and WHOLE_RUN_SENTENCE_LEADS are loaded inside the test body: the AC test
// is written before the exported list exists, so nothing the build adds may run while the file loads. The accept label
// may lift a per-file TEST_INTEGRITY_INDEX_UNAVAILABLE error but never one holding a whole-run sentence, and the label
// tells them apart by that list. So every "did not run" sentence check() can write must start with an entry of it,
// and every entry must be one check() writes: a new whole-run sentence the list does not know fails here.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
/** Reasons without a full stop, so a sentence split on ". " cannot cut one. */
const REASON = "the base commit is not in the checkout";

interface Message {
  code: string;
  level: string;
  text: string;
}
interface Report {
  messages: Message[];
}

const BASE = [
  'import { expect, it } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'it("adds the prices", () => {',
  "  expect(total([2, 3])).toBe(5);",
  "});",
  "",
].join("\n");
const HEAD = BASE.replace("toBe(5);", "toBe(5);\n  expect(total([1])).toBe(1);");
const PY_BASE =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n\n\ndef test_empty():\n    assert total([]) == 0\n";
const PY_HEAD = "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n";

function modified(path: string, header: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, header, ...lines].join("\n")}\n`;
}
const JS_DIFF = modified("src/a.test.ts", "@@ -5,0 +6 @@", ["+  expect(total([1])).toBe(1);"]);
const side = (path: string, text: string) => ({ files: [{ path, text }], dropped: [] });

async function run(input: Record<string, unknown>): Promise<Report> {
  const { check } = (await import("./text-coverage.js")) as unknown as { check(input: unknown): unknown };
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: ["src/a.test.ts", "src/cart.ts", "tests/test_c.py", "vitest.config.ts"],
    testIntegrityMode: { input: "block" },
    ...input,
  });
  expectValidReport(report);
  return report as Report;
}

/** The sentences of every TEST_INTEGRITY_INDEX_UNAVAILABLE text that say a check did not run. */
const didNotRun = (report: Report): string[] =>
  report.messages
    .filter((m) => m.code === CODE)
    .flatMap((m) => m.text.split(/(?<=\.)\s+/))
    .filter((sentence) => sentence.includes("did not run"));

describe("CORE-69: the exported list of whole-run sentences matches what check() writes", () => {
  it("AC-17: every did-not-run sentence check() writes into TEST_INTEGRITY_INDEX_UNAVAILABLE starts with an entry of WHOLE_RUN_SENTENCE_LEADS, and every entry starts one", async () => {
    const core = {
      ...(await import("../src/testIntegrityUnreadable.js")),
      ...(await import("../src/testSources.js")),
    } as unknown as {
      WHOLE_RUN_SENTENCE_LEADS?: unknown;
      unavailableTestSources(reason: string): { base: unknown; head: unknown };
    };
    const leads = core.WHOLE_RUN_SENTENCE_LEADS;
    expect(Array.isArray(leads), "WHOLE_RUN_SENTENCE_LEADS is an array").toBe(true);
    const entries = leads as unknown[];
    expect(entries.length, "it is not empty").toBeGreaterThan(0);
    for (const entry of entries) {
      expect(typeof entry, "each entry is a string").toBe("string");
      expect((entry as string).length, "each entry is non-empty").toBeGreaterThan(0);
    }

    const both = core.unavailableTestSources(REASON);
    expect(Object.keys(both).sort(), "unavailable sources have a base and a head side").toEqual(["base", "head"]);
    const inputs: [string, Record<string, unknown>][] = [
      ["TI02 and TI05, sources unavailable on both sides", { diff: { text: JS_DIFF }, testSources: both }],
      [
        "TI02 and TI05, the base side unavailable",
        { diff: { text: JS_DIFF }, testSources: { base: both.base, head: side("src/a.test.ts", HEAD) } },
      ],
      [
        "TI02 and TI05, the head side unavailable",
        { diff: { text: JS_DIFF }, testSources: { base: side("src/a.test.ts", BASE), head: both.head } },
      ],
      [
        "TI02 and TI05, python-not-found",
        {
          diff: {
            text: modified("tests/test_c.py", "@@ -6,4 +5,0 @@", [
              "-",
              "-",
              "-def test_empty():",
              "-    assert total([]) == 0",
            ]),
          },
          testSources: { base: side("tests/test_c.py", PY_BASE), head: side("tests/test_c.py", PY_HEAD) },
          pythonTestIndex: { available: false, reason: "python-not-found", detail: "python3: command not found" },
        },
      ],
      [
        "TI09, a touched test-config file with the sources unavailable",
        {
          diff: { text: modified("vitest.config.ts", "@@ -3 +3 @@", ["-  test: {},", "+  test: { globals: true },"]) },
          testSources: both,
        },
      ],
    ];

    const produced: string[] = [];
    for (const [name, input] of inputs) {
      const sentences = didNotRun(await run(input));
      expect(sentences.length, `${name}: check() writes a did-not-run sentence`).toBeGreaterThan(0);
      produced.push(...sentences);
    }
    for (const sentence of produced) {
      expect(
        (entries as string[]).some((lead) => sentence.startsWith(lead)),
        `"${sentence}" starts with an entry of WHOLE_RUN_SENTENCE_LEADS`,
      ).toBe(true);
    }
    for (const lead of entries as string[]) {
      expect(
        produced.some((sentence) => sentence.startsWith(lead)),
        `"${lead}" starts at least one produced sentence`,
      ).toBe(true);
    }
  });
});
