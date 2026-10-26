import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Skylos nine, part 2: what each warn-case and miss-case diff (and the mock.ANY variant) changes. The diffs are written
// by the build, so they are read and parsed inside each test body; the expected lines are written here.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const CASES_DIR = `${FIXTURES}skylos-nine-pytest/`;
const TEST_FILE = "tests/test_cart.py";
const SOURCE_FILE = "src/cart.py";
const ORIGINAL = "assert total([2, 3]) == 5";

interface ChangedFile {
  path: string;
  status: string;
  added: string[];
  removed: string[];
}

/** The case's diff as its files, each with the text of the lines it adds and removes. */
async function changes(name: string): Promise<ChangedFile[]> {
  const { parseUnifiedDiff } = await import("@pharn-ci/core");
  const text = readFileSync(`${CASES_DIR}${name}/change.diff`, "utf8");
  return parseUnifiedDiff(text, { keepText: () => true }).map((file) => ({
    path: file.path,
    status: file.status,
    added: (file.hunks ?? []).flatMap((hunk) => hunk.added.map((line) => line.text)),
    removed: (file.hunks ?? []).flatMap((hunk) => hunk.removed.map((line) => line.text)),
  }));
}

function only(files: ChangedFile[], path: string, label: string): ChangedFile {
  const found = files.filter((file) => file.path === path);
  expect(found, `${label}: one entry for ${path}`).toHaveLength(1);
  return found[0] as ChangedFile;
}

const holding = (lines: string[], needle: string) => lines.filter((line) => line.includes(needle));

function expectHolds(lines: string[], needle: string, label: string): void {
  expect(holding(lines, needle).length, `${label}: a line holding ${needle}`).toBeGreaterThan(0);
}

describe("Skylos nine for pytest: the warn-case and miss-case diffs", () => {
  it("AC-4: loosened-assertion removes assert total([2, 3]) == 5 and adds assert total([2, 3]) with no ==", async () => {
    const file = only(await changes("loosened-assertion"), TEST_FILE, "loosened-assertion");
    expectHolds(file.removed, ORIGINAL, "removed");
    const loosened = holding(file.added, "assert total([2, 3])");
    expect(loosened.length, "an added assert total([2, 3]) line").toBeGreaterThan(0);
    for (const line of loosened) expect(line, "the added assert has no ==").not.toContain("==");
  });

  it("AC-4: edited-expected-value changes == 5 to == 6 in the test and return sum(prices) to return sum(prices) + 1 in src/cart.py", async () => {
    const files = await changes("edited-expected-value");
    const test = only(files, TEST_FILE, "edited-expected-value");
    expectHolds(test.removed, ORIGINAL, "test removed");
    expectHolds(test.added, "assert total([2, 3]) == 6", "test added");
    const source = only(files, SOURCE_FILE, "edited-expected-value");
    expect(
      source.removed.map((line) => line.trim()),
      "source removed",
    ).toContain("return sum(prices)");
    expectHolds(source.added, "return sum(prices) + 1", "source added");
  });

  it("AC-4: hard-coded-answer touches only src/cart.py and adds the if len(prices) == 2 and prices[0] == 2: guard and return 5", async () => {
    const files = await changes("hard-coded-answer");
    expect(files.map((f) => f.path)).toEqual([SOURCE_FILE]);
    const source = files[0] as ChangedFile;
    expectHolds(source.added, "if len(prices) == 2 and prices[0] == 2:", "added");
    expectHolds(source.added, "return 5", "added");
  });

  it("AC-4: always-true-matcher adds def matches_total(value): and return True to tests/test_cart.py and turns the assertion into assert matches_total(total([2, 3]))", async () => {
    const file = only(await changes("always-true-matcher"), TEST_FILE, "always-true-matcher");
    expectHolds(file.added, "def matches_total(value):", "added");
    expectHolds(file.added, "return True", "added");
    expectHolds(file.removed, ORIGINAL, "removed");
    expectHolds(file.added, "assert matches_total(total([2, 3]))", "added");
  });

  it("AC-4: always-true-matcher-any adds from unittest.mock import ANY and turns the assertion into assert total([2, 3]) == ANY", async () => {
    const file = only(await changes("always-true-matcher-any"), TEST_FILE, "always-true-matcher-any");
    expect(
      file.added.map((line) => line.trim()),
      "the ANY import",
    ).toContain("from unittest.mock import ANY");
    expectHolds(file.removed, ORIGINAL, "removed");
    expectHolds(file.added, "assert total([2, 3]) == ANY", "added");
  });
});
