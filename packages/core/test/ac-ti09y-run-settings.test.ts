import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 exists, so nothing that depends on it
// may run while the file loads. The controls run in the same test as the cases that must trigger.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "vitest.config.ts";

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Report {
  testIntegrity: { signals: Signal[] };
  messages: { code: string; level: string; text: string }[];
}

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf(path: string, base: string, head: string): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

/** check() in mode block over a modified vitest.config.ts with this base and head text; its TI09 signals. */
async function run(base: string, head: string): Promise<Signal[]> {
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
  return (report as unknown as Report).testIntegrity.signals.filter((s) => String(s.id) === "TI09");
}

/** A vitest config whose `test` key holds the include list and these extra lines. */
const config = (...extra: string[]) =>
  [
    'import { defineConfig } from "vitest/config";',
    "",
    "export default defineConfig({",
    "  test: {",
    '    include: ["src/**/*.test.ts"],',
    ...extra.map((line) => `    ${line},`),
    "  },",
    "});",
    "",
  ].join("\n");

describe("TI09: vitest run settings", () => {
  it("AC-5: passWithNoTests and allowOnly turned on and an added or lowered bail are block, a raised retry and two raised timeouts are warn, and a 4x timeout or passWithNoTests turned off give none", async () => {
    const cases: { label: string; base: string; head: string; key: string; severity: string }[] = [
      {
        label: "passWithNoTests added true",
        base: config(),
        head: config("passWithNoTests: true"),
        key: "test.passWithNoTests",
        severity: "block",
      },
      {
        label: "allowOnly added true",
        base: config(),
        head: config("allowOnly: true"),
        key: "test.allowOnly",
        severity: "block",
      },
      { label: "bail added", base: config(), head: config("bail: 1"), key: "test.bail", severity: "block" },
      {
        label: "bail lowered 5 → 2",
        base: config("bail: 5"),
        head: config("bail: 2"),
        key: "test.bail",
        severity: "block",
      },
      {
        label: "retry raised 0 → 2",
        base: config("retry: 0"),
        head: config("retry: 2"),
        key: "test.retry",
        severity: "warn",
      },
      {
        label: "testTimeout raised 5000 → 50000",
        base: config("testTimeout: 5000"),
        head: config("testTimeout: 50000"),
        key: "test.testTimeout",
        severity: "warn",
      },
      {
        label: "hookTimeout set from unset to 60000",
        base: config(),
        head: config("hookTimeout: 60000"),
        key: "test.hookTimeout",
        severity: "warn",
      },
    ];
    for (const { label, base, head, key, severity } of cases) {
      const signals = await run(base, head);
      expect(signals, `${label}: one TI09 signal`).toHaveLength(1);
      expect(signals[0]?.severity, label).toBe(severity);
      expect(signals[0]?.path).toBe(PATH);
      expect(signals[0]?.detail, `${label} names the key`).toContain(key);
    }

    expect(
      await run(config("testTimeout: 5000"), config("testTimeout: 20000")),
      "testTimeout 5000 → 20000: no TI09 signal",
    ).toEqual([]);
    expect(
      await run(config("passWithNoTests: true"), config("passWithNoTests: false")),
      "passWithNoTests true → false: no TI09 signal",
    ).toEqual([]);
  });
});
