import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Skylos nine, part 2: what each block-case diff (and the aliased-skip variant) changes. The diffs are written by the
// build, so they are read and parsed inside each test body; the expected lines are written here.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const CASES_DIR = `${FIXTURES}skylos-nine-pytest/`;
const TEST_FILE = "tests/test_cart.py";

interface ChangedFile {
  path: string;
  oldPath: string;
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
    oldPath: file.oldPath,
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

describe("Skylos nine for pytest: the block-case diffs", () => {
  it("AC-3: deleted-test deletes tests/test_cart.py and only it", async () => {
    const files = await changes("deleted-test");
    expect(files.map((f) => [f.path, f.status])).toEqual([[TEST_FILE, "deleted"]]);
  });

  it("AC-3: added-skip adds one line holding @pytest.mark.skip(reason= to tests/test_cart.py and removes no def test_ line", async () => {
    const file = only(await changes("added-skip"), TEST_FILE, "added-skip");
    expect(holding(file.added, "@pytest.mark.skip(reason="), "one added skip line").toHaveLength(1);
    expect(holding(file.removed, "def test_"), "no removed def test_ line").toEqual([]);
  });

  it("AC-3: added-skip-aliased adds from pytest import mark and a line holding @mark.skip( to tests/test_cart.py, and no added line holds pytest.mark", async () => {
    const file = only(await changes("added-skip-aliased"), TEST_FILE, "added-skip-aliased");
    expect(
      file.added.map((line) => line.trim()),
      "the alias import",
    ).toContain("from pytest import mark");
    expect(holding(file.added, "@mark.skip(").length, "an added @mark.skip( line").toBeGreaterThan(0);
    expect(holding(file.added, "pytest.mark"), "no added line holds pytest.mark").toEqual([]);
  });

  it("AC-3: emptied-assertion removes the line holding assert total([2, 3]) == 5 and adds a line holding total([2, 3]) with no assert", async () => {
    const file = only(await changes("emptied-assertion"), TEST_FILE, "emptied-assertion");
    expect(holding(file.removed, "assert total([2, 3]) == 5").length, "the assertion removed").toBeGreaterThan(0);
    const calls = holding(file.added, "total([2, 3])");
    expect(calls.length, "an added line holding total([2, 3])").toBeGreaterThan(0);
    for (const line of calls) expect(line, "the added call has no assert").not.toContain("assert");
  });

  it('AC-3: deselect-setting touches only pyproject.toml, removes testpaths = ["tests"] and adds testpaths = ["tests/fast"]', async () => {
    const files = await changes("deselect-setting");
    expect(files.map((f) => f.path)).toEqual(["pyproject.toml"]);
    const file = files[0] as ChangedFile;
    expect(file.removed.map((line) => line.trim())).toContain('testpaths = ["tests"]');
    expect(file.added.map((line) => line.trim())).toContain('testpaths = ["tests/fast"]');
  });

  it("AC-3: replaced-test modifies tests/test_cart.py, removes def test_rejects_a_negative_price and adds def test_accepts_an_empty_cart", async () => {
    const file = only(await changes("replaced-test"), TEST_FILE, "replaced-test");
    expect(file.status).toBe("modified");
    expect(holding(file.removed, "def test_rejects_a_negative_price").length, "the old test removed").toBeGreaterThan(
      0,
    );
    expect(holding(file.added, "def test_accepts_an_empty_cart").length, "the new test added").toBeGreaterThan(0);
  });
});
