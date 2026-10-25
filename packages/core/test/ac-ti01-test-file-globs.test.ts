import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// isTestFile() is loaded inside the test body: the AC tests are written before the build, so nothing the build
// changes may run while the file loads.

const TESTS = [
  "src/a.test.ts",
  "a.spec.jsx",
  "lib/x.test.mjs",
  "lib/x.test.cjs",
  "pkg/__tests__/x.js",
  "test/x.ts",
  "packages/a/tests/data.json",
  "e2e/login.e2e.ts",
  "e2e/login.pw.ts",
  "test_foo.py",
  "pkg/foo_test.py",
  "pkg/foo_test.go",
];

const NOT_TESTS = [
  "src/latest.ts",
  "src/contest.ts",
  "src/testing/x.ts",
  "a.test.md",
  "Test.go",
  "test_foo.txt",
  "src/a_tests.py",
  "src/Test/x.ts",
];

/** The paths the fixtures under fixtures/test-files-deleted/ delete or rename away, as the existing tests name them. */
const EXISTING_FIXTURE_TESTS = [
  "lib/seven.test.mjs",
  "packages/a/test/one.ts",
  "src/__tests__/two.tsx",
  "src/four.test.js",
  "src/three.spec.ts",
  "test/five.ts",
  "tests/six.py",
];

describe("isTestFile(): the test-file globs", () => {
  it("AC-1: the spec's test paths are test files, the near misses are not, and the existing fixtures' paths stay test files", async () => {
    const { isTestFile } = await import("../src/testFiles.js");

    const wrong: string[] = [];
    for (const path of TESTS) if (!isTestFile(path)) wrong.push(`${path} should be a test file`);
    for (const path of NOT_TESTS) if (isTestFile(path)) wrong.push(`${path} should not be a test file`);
    for (const path of EXISTING_FIXTURE_TESTS) if (!isTestFile(path)) wrong.push(`${path} should stay a test file`);

    // The tracked files of the deleted-test fixtures that carry a test marker keep their classification as well.
    const tracked = fixture("test-files-deleted/files.txt").trim().split("\n");
    for (const path of tracked.filter((p) => /(^|\/)(tests?|__tests__)\//.test(p) || /\.(test|spec)\./.test(p))) {
      if (!isTestFile(path)) wrong.push(`${path} should stay a test file`);
    }

    expect(wrong).toEqual([]);
  });
});
