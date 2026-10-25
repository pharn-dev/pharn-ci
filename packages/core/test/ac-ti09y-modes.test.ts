import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 exists, so nothing that depends on it
// may run while the file loads. The base and head texts and the diff are written here.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "vitest.config.ts";

type Mode = "block" | "warn" | "off";
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

const config = (lines: number) =>
  [
    'import { defineConfig } from "vitest/config";',
    "",
    "export default defineConfig({",
    "  test: {",
    "    coverage: {",
    "      thresholds: {",
    `        lines: ${lines},`,
    "      },",
    "    },",
    "  },",
    "});",
    "",
  ].join("\n");
const BASE = config(90);
const HEAD = config(70);
const HEAD_LINE = linesOf(HEAD).findIndex((line) => line.trim().startsWith("lines:")) + 1;

async function run(mode: Mode, withSources: boolean): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diffOf(PATH, BASE, HEAD) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", PATH],
    testIntegrityMode: { input: mode },
    ...(withSources
      ? {
          testSources: {
            base: { files: [{ path: PATH, text: BASE }], dropped: [] },
            head: { files: [{ path: PATH, text: HEAD }], dropped: [] },
          },
        }
      : {}),
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

const ti09 = (report: Report) => report.testIntegrity.signals.filter((s) => String(s.id) === "TI09");
const ti09Messages = (report: Report) => report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI09");

describe("TI09: a lowered vitest coverage threshold, in each mode", () => {
  it("AC-2: block gives one block TI09 at the head line of lines with the lowered detail, warn gives it as warn, and off or no test sources give no TI09 signal and no TEST_INTEGRITY_TI09 message", async () => {
    expect(HEAD_LINE, "the head line of the lines property").toBe(7);
    const expected = {
      id: "TI09",
      path: PATH,
      line: HEAD_LINE,
      detail: "test.coverage.thresholds.lines lowered: 90 → 70.",
    };

    const block = ti09(await run("block", true));
    expect(block, "block: one TI09 signal").toHaveLength(1);
    expect(block[0]).toMatchObject({ ...expected, severity: "block" });

    const warn = ti09(await run("warn", true));
    expect(warn, "warn: one TI09 signal").toHaveLength(1);
    expect(warn[0]).toMatchObject({ ...expected, severity: "warn" });

    const off = await run("off", true);
    expect(ti09(off), "off: no TI09 signal").toEqual([]);
    expect(ti09Messages(off), "off: no TEST_INTEGRITY_TI09 message").toEqual([]);

    const noSources = await run("block", false);
    expect(ti09(noSources), "no test sources: no TI09 signal").toEqual([]);
    expect(ti09Messages(noSources), "no test sources: no TEST_INTEGRITY_TI09 message").toEqual([]);
  });
});
