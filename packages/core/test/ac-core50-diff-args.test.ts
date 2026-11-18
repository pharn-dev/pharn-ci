import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-50 (binary-diff-not-blind). gitDiffArgs() and check() are loaded inside the test body. pharn-ci keeps git's binary
// output (no `--text`, no `-a`), which held at the base commit too; the control, in the same test, is new behaviour: the
// diff those arguments give for a test file deleted under `*.test.ts -diff`, in a real temporary git repository, is read
// by check() as a TI01 block.

const TEST_PATH = "src/cart.test.ts";

describe("CORE-50: pharn-ci does not add --text to its git diff arguments", () => {
  it("AC-20: gitDiffArgs('abc123') holds neither --text nor -a, and the binary diff those arguments give for a deleted -diff test file is a TI01 block", async () => {
    const { gitDiffArgs } = await import("../src/inputs.js");
    const args = gitDiffArgs("abc123");
    expect(args, "no --text").not.toContain("--text");
    expect(args, "no -a").not.toContain("-a");

    // Control: the arguments keep git's binary line, and check() reads that entry as a deleted test file.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-core50-args-")));
    try {
      const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
      git("init", "-q", "-b", "main");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "test");
      git("config", "commit.gpgsign", "false");
      mkdirSync(join(dir, "src"));
      writeFileSync(
        join(dir, "src/cart.ts"),
        "export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n",
      );
      writeFileSync(
        join(dir, TEST_PATH),
        'import { expect, it } from "vitest";\nimport { total } from "./cart.js";\n\nit("adds", () => {\n  expect(total([2, 3])).toBe(5);\n});\n',
      );
      git("add", "-A");
      git("commit", "-q", "-m", "base");
      const base = git("rev-parse", "HEAD").trim();
      writeFileSync(join(dir, ".gitattributes"), "*.test.ts -diff\n");
      rmSync(join(dir, TEST_PATH));
      git("add", "-A");
      git("commit", "-q", "-m", "head");

      const diff = git(...gitDiffArgs(base));
      expect(diff.split("\n"), "git shows the deleted test file as binary").toContain(
        `Binary files a/${TEST_PATH} and /dev/null differ`,
      );

      const { check } = await import("../src/check.js");
      const report = check({
        version: "0.1.0",
        coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
        diff: { text: diff },
        repoRoot: "/home/runner/work/demo/demo",
        threshold: null,
        repoFiles: [".gitattributes", "src/cart.ts"],
        testIntegrityMode: { input: "block" },
      } as unknown as Parameters<typeof check>[0]);
      expectValidReport(report);
      expect(
        report.testIntegrity.signals.filter((s) => s.id === "TI01").map((s) => [s.path, s.severity]),
        "the binary deletion is a TI01 block",
      ).toEqual([[TEST_PATH, "block"]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
