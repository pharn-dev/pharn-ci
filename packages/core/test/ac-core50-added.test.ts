import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import { FIXTURES } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import type { TextCheckInput } from "./text-coverage.js";

// CORE-50 (binary-diff-not-blind). check() is loaded inside the test body: the AC test is written before an added test
// file that git shows as binary is named, so nothing the build changes may run while the file loads. The case is read
// inside the test body; its diff lines are checked first. The added-files sentence is matched by the path and the
// reason code, not by its wording.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const PATH = "src/new.test.ts";

async function run(diff: string, extra: Partial<TextCheckInput>): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: [PATH, "src/cart.ts"],
    testIntegrityMode: { input: "block" },
    ...extra,
  });
  expectValidReport(report);
  return report;
}

describe("CORE-50: an added test file that git shows as binary is named as a warning", () => {
  it("AC-8: a binary src/new.test.ts, with head sources that index it and without, gives a TEST_INTEGRITY_INDEX_UNAVAILABLE warning naming it with `binary`, and no fail from it", async () => {
    const dir = `${FIXTURES}test-integrity/index-unavailable/binary-added`;
    const diff = readFileSync(join(dir, "change.diff"), "utf8");
    const lines = diff.split("\n");
    expect(lines).toContain("new file mode 100644");
    expect(lines).toContain(`Binary files /dev/null and b/${PATH} differ`);
    const headText = join(dir, "head", `${PATH}.txt`);
    expect(existsSync(headText), "the case holds the head text of the added file").toBe(true);

    const runs: [string, Partial<TextCheckInput>][] = [
      [
        "with head sources",
        {
          testSources: {
            base: { files: [], dropped: [] },
            head: { files: [{ path: PATH, text: readFileSync(headText, "utf8") }], dropped: [] },
          },
        },
      ],
      ["without sources", {}],
    ];
    for (const [name, extra] of runs) {
      const report = await run(diff, extra);
      const messages = report.messages.filter((m) => m.code === CODE);
      expect(messages, `${name}: one ${CODE} message`).toHaveLength(1);
      expect(messages[0]?.level, `${name}: a warning`).toBe("warn");
      expect(messages[0]?.text, `${name}: names the added file with the reason binary`).toContain(
        `\`${PATH}\` (\`binary\`)`,
      );
      expect(
        report.messages.filter((m) => m.level === "error"),
        `${name}: no error`,
      ).toEqual([]);
      expect(report.verdict, `${name}: not fail`).not.toBe("fail");
    }
  });
});
