import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import { FIXTURES } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-50 (binary-diff-not-blind). check() is loaded inside the test body: the AC test is written before a binary test
// file counts, so nothing the build changes may run while the file loads. Files git shows as binary that are not test
// files the signals read (an image under tests/, a .bin, a snapshot, an asset) keep giving nothing. The base result of
// each input was recorded on the base commit 0942691 with the same check() inputs: no test-integrity signal, no
// TEST_INTEGRITY_INDEX_UNAVAILABLE message, verdict `pass`. A deleted binary src/cart.test.ts beside them is the control,
// in the same test, that is new behaviour.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATHS = ["assets/logo.png", "src/__snapshots__/cart.test.ts.snap", "tests/data.bin", "tests/fixtures/cart.png"];
/** The verdict each AC-4 input gave at the base commit 0942691 (recorded there with these check() inputs). */
const BASE_VERDICT = "pass";

interface Entry {
  path: string;
  lines: string[];
}

function entries(diff: string): Entry[] {
  const out: Entry[] = [];
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
    if (header) {
      out.push({ path: header[2] as string, lines: [line] });
      continue;
    }
    out.at(-1)?.lines.push(line);
  }
  return out;
}

async function run(diff: string): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: readFileSync(`${FIXTURES}test-files-deleted/files.txt`, "utf8").trim().split("\n"),
    testIntegrityMode: { input: "block" },
  });
  expectValidReport(report);
  return report;
}

const DELETED_TEST = `${[
  "diff --git a/src/cart.test.ts b/src/cart.test.ts",
  "deleted file mode 100644",
  "index 5555555..0000000",
  "Binary files a/src/cart.test.ts and /dev/null differ",
].join("\n")}\n`;

describe("CORE-50: binary files that are not test files the signals read give nothing new", () => {
  it("AC-4: deleting or modifying tests/fixtures/cart.png, tests/data.bin, a .snap file and assets/logo.png as binary entries gives no TI01, no TEST_INTEGRITY_INDEX_UNAVAILABLE, no other signal, and the base verdict", async () => {
    const cases = [
      ["TI01/pass-binary-not-test-deleted", "deleted"],
      ["index-unavailable/pass-binary-not-test-modified", "modified"],
    ] as const;
    for (const [name, kind] of cases) {
      const diff = readFileSync(`${FIXTURES}test-integrity/${name}/change.diff`, "utf8");
      const files = entries(diff);
      expect(files.map((e) => e.path).sort(), `${name}: the four paths and nothing else`).toEqual(PATHS);
      for (const entry of files) {
        expect(
          entry.lines.some((l) => /^Binary files .* differ$/.test(l)),
          `${name}: ${entry.path} is a binary entry`,
        ).toBe(true);
        expect(entry.lines.includes("deleted file mode 100644"), `${name}: ${entry.path} is ${kind}`).toBe(
          kind === "deleted",
        );
        expect(
          entry.lines.some((l) => l.startsWith("new file mode") || l.startsWith("rename ")),
          `${name}: ${entry.path} is neither added nor renamed`,
        ).toBe(false);
      }

      const report = await run(diff);
      expect(report.testIntegrity.signals, `${name}: no test-integrity signal, as at the base commit`).toEqual([]);
      expect(
        report.messages.filter((m) => m.code === "TEST_INTEGRITY_INDEX_UNAVAILABLE"),
        `${name}: no TEST_INTEGRITY_INDEX_UNAVAILABLE`,
      ).toEqual([]);
      expect(
        report.messages.filter((m) => m.code === "TEST_INTEGRITY_TI01"),
        `${name}: no TEST_INTEGRITY_TI01`,
      ).toEqual([]);
      expect(report.verdict, `${name}: the verdict at the base commit`).toBe(BASE_VERDICT);

      // Control: a deleted binary src/cart.test.ts beside the same entries is one TI01 block, and only it.
      const withTest = await run(`${diff.endsWith("\n") ? diff : `${diff}\n`}${DELETED_TEST}`);
      expect(
        withTest.testIntegrity.signals.filter((s) => s.id === "TI01").map((s) => [s.path, s.severity]),
        `${name}: the control counts only the test file`,
      ).toEqual([["src/cart.test.ts", "block"]]);
    }
  });
});
