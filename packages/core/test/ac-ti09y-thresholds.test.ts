import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 exists, so nothing that depends on it
// may run while the file loads. The controls run in the same test as the cases that must trigger, so the test cannot
// pass before TI09 exists.

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

/** check() in mode block over a modified vitest.config.ts with this base and head text. */
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

/** A vitest config whose `test.coverage` holds these lines. */
const config = (...coverage: string[]) =>
  [
    'import { defineConfig } from "vitest/config";',
    "",
    "export default defineConfig({",
    "  test: {",
    "    coverage: {",
    ...coverage.map((line) => `      ${line}`),
    "    },",
    "  },",
    "});",
    "",
  ].join("\n");

const thresholds = (...entries: string[]) => config("thresholds: {", ...entries.map((e) => `  ${e},`), "},");

const BASE = thresholds("lines: 90", "branches: 80", "100: true", "perFile: true", "autoUpdate: false");

describe("TI09: the vitest coverage thresholds subtree", () => {
  it("AC-3: a removed branches, 100 and perFile turned off or removed, autoUpdate turned on and a lowered legacy coverage.lines each give one block TI09 naming the dotted key, and a raised lines or a reformat give none", async () => {
    const loosening: { head: string; key: string; verb: string; values: string }[] = [
      {
        head: thresholds("lines: 90", "100: true", "perFile: true", "autoUpdate: false"),
        key: "test.coverage.thresholds.branches",
        verb: "removed",
        values: "80",
      },
      {
        head: thresholds("lines: 90", "branches: 80", "100: false", "perFile: true", "autoUpdate: false"),
        key: "test.coverage.thresholds.100",
        verb: "turned off",
        values: "true → false",
      },
      {
        head: thresholds("lines: 90", "branches: 80", "100: true", "autoUpdate: false"),
        key: "test.coverage.thresholds.perFile",
        verb: "removed",
        values: "true",
      },
      {
        head: thresholds("lines: 90", "branches: 80", "100: true", "perFile: true", "autoUpdate: true"),
        key: "test.coverage.thresholds.autoUpdate",
        verb: "turned on",
        values: "false → true",
      },
    ];
    for (const { head, key, verb, values } of loosening) {
      const signals = await run(BASE, head);
      expect(signals, `${key} ${verb}: one TI09 signal`).toHaveLength(1);
      const signal = signals[0] as Signal;
      expect(signal.severity, `${key} ${verb}`).toBe("block");
      expect(signal.path).toBe(PATH);
      expect(signal.detail, `${key} ${verb}`).toContain(`${key} ${verb}`);
      expect(signal.detail, `${key} ${verb} names the values`).toContain(values);
    }

    const legacy = await run(config("lines: 90,"), config("lines: 85,"));
    expect(legacy, "legacy coverage.lines lowered: one TI09 signal").toHaveLength(1);
    expect(legacy[0]?.severity).toBe("block");
    expect(legacy[0]?.detail).toContain("test.coverage.lines lowered");
    expect(legacy[0]?.detail).toContain("90 → 85");

    const raised = await run(
      BASE,
      thresholds("lines: 95", "branches: 80", "100: true", "perFile: true", "autoUpdate: false"),
    );
    expect(raised, "lines raised to 95: no TI09 signal").toEqual([]);

    const reformatted = config(
      "thresholds: {",
      "  'autoUpdate': false,",
      '  "perFile": true,',
      '  "100": true,',
      "  'branches': 80,",
      '  "lines":',
      "    90",
      "},",
    );
    expect(await run(BASE, reformatted), "same values in another order, quotes and line breaks: no TI09").toEqual([]);
  });
});
