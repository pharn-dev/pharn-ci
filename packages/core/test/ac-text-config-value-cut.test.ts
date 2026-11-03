import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body, the AC-test convention for a behaviour the build changes. The include entry
// is 90 code units that end in astral characters; TI09 reports the list as JSON (`["…"]`), so the entry starts at
// unit 2 of the reported value and a high surrogate sits at unit 78, the cut point of an 80-unit limit with the …
// inside it.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "vitest.config.ts";
const LIMIT = 80;

interface Signal {
  id: string;
  severity: string;
  path: string;
  detail: string;
  base?: string;
  head?: string;
}

/** A high surrogate not followed by a low one, or a low surrogate not preceded by a high one. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** 76 ASCII code units, then seven emoji: 90 code units ending in astral characters. */
const LONG_ENTRY = `src/${"x".repeat(72)}${"😀".repeat(7)}`;

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf(path: string, base: string, head: string): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

/** A vitest config whose test.include holds these entries. */
const config = (include: string[]) =>
  [
    'import { defineConfig } from "vitest/config";',
    "",
    "export default defineConfig({",
    "  test: {",
    `    include: ${JSON.stringify(include)},`,
    "  },",
    "});",
    "",
  ].join("\n");

/** check() in mode block over a modified vitest.config.ts with these include lists; its TI09 signals. */
async function run(baseInclude: string[], headInclude: string[]): Promise<Signal[]> {
  const base = config(baseInclude);
  const head = config(headInclude);
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diffOf(PATH, base, head) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", PATH],
    testIntegrityMode: { input: "block" },
    testSources: {
      base: { files: [{ path: PATH, text: base }], dropped: [] },
      head: { files: [{ path: PATH, text: head }], dropped: [] },
    },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return (report.testIntegrity.signals as unknown as Signal[]).filter((s) => String(s.id) === "TI09");
}

function expectCutValue(value: string | undefined, label: string) {
  expect(value, `${label} is reported`).toBeDefined();
  const text = value as string;
  expect(text.length, `${label} is at most ${LIMIT} UTF-16 code units`).toBeLessThanOrEqual(LIMIT);
  expect(text.endsWith("…"), `${label} ends with …`).toBe(true);
  expect(LONE_SURROGATE.test(text), `${label} holds no lone surrogate`).toBe(false);
}

describe("TI09: a long config value cut to its limit", () => {
  it("AC-3: a 90-code-unit config value ending in astral characters is reported as a base / head value of at most 80 UTF-16 code units that ends with … and holds no lone surrogate", async () => {
    expect(LONG_ENTRY.length, "the config value is 90 code units").toBe(90);
    expect(LONG_ENTRY.codePointAt(LONG_ENTRY.length - 2), "it ends in an astral character").toBe(0x1f600);
    const shown = JSON.stringify([LONG_ENTRY]);
    const unit = shown.charCodeAt(LIMIT - 2);
    expect(unit >= 0xd800 && unit < 0xdc00, "the reported value holds a high surrogate at the cut point").toBe(true);

    const narrowed = await run(["src/**/*.test.ts"], [LONG_ENTRY]);
    expect(narrowed, "the long head value: one TI09 signal").toHaveLength(1);
    expectCutValue(narrowed[0]?.head, "head");

    const dropped = await run([LONG_ENTRY, "src/**/*.test.ts"], ["src/**/*.test.ts"]);
    expect(dropped, "the long base value: one TI09 signal").toHaveLength(1);
    expectCutValue(dropped[0]?.base, "base");
  }, 120_000);
});
