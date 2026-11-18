import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// CORE-104 (R3.8): the Python test index also returns, per parsed file, the module names of every import statement in
// it (ast.walk over the whole module, not only the top level), for the tests-exercise check. The real python3 runs and
// there is no skip: with no usable python3 the run is unavailable and the tests fail. The index is loaded inside each
// test body, so nothing the build changes runs while the file loads.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const SLOW = 60_000;

interface IndexedFile {
  path: string;
  result: { parsed: boolean };
  imports?: string[];
}

async function indexOne(path: string, text: string): Promise<IndexedFile> {
  const { indexPythonTests } = await import("../src/index.js");
  const run = await indexPythonTests([{ path, text }]);
  if (!run.available) throw new Error(`the Python index is unavailable: ${run.reason} (${run.detail})`);
  const [file] = run.files as IndexedFile[];
  if (file === undefined) throw new Error("the run gave no file");
  return file;
}

describe("CORE-104: the Python index returns the module names a test file imports", () => {
  it(
    "AC-1: every import and from-import of the module, nested ones too, in ast.walk order, once each, with relative dots kept",
    async () => {
      const file = await indexOne(
        "tests/test_forms.py",
        readFileSync(`${FIXTURES}exercise/py-imports/all-forms.py.txt`, "utf8"),
      );
      expect(file.result.parsed).toBe(true);
      expect(file.imports).toEqual([
        "os",
        "a.b",
        "x.y",
        "x.y.p",
        "x.y.q",
        ".billing",
        "..pkg.mod",
        "..pkg.mod.x",
        "..up",
        "star",
        "zz",
        "yy.k",
        "inner.mod",
        "inner.mod.thing",
        "lazy",
        "guarded",
        ".sibling",
        ".sibling.helper",
      ]);
    },
    SLOW,
  );

  it(
    "AC-2: the field is optional: a file that imports nothing carries no imports key and the same result as before",
    async () => {
      const text = "def test_a():\n    assert 1 == 1\n";
      const file = await indexOne("tests/test_plain.py", text);
      expect(Object.keys(file).sort()).toEqual(["path", "result"]);
      // Control: the same file with one import carries it.
      const withImport = await indexOne("tests/test_plain.py", `import pkg.billing\n${text}`);
      expect(withImport.imports).toEqual(["pkg.billing"]);
      expect(withImport.result.parsed).toBe(true);
    },
    SLOW,
  );

  it(
    "AC-3: keeps at most 1000 names per file (core's MAX_TEST_IMPORTS), the first ones, and leaves out a name over 500 characters",
    async () => {
      const { MAX_TEST_IMPORTS } = await import("@pharn-ci/core");
      expect(MAX_TEST_IMPORTS).toBe(1000);
      const { PYTHON_INDEX_SCRIPT } = await import("../src/pythonIndexScript.js");
      expect(PYTHON_INDEX_SCRIPT).toContain(`\nMAX_IMPORTS = ${MAX_TEST_IMPORTS}\n`);

      const names = Array.from({ length: 1005 }, (_, i) => `m${String(i).padStart(4, "0")}`);
      const many = await indexOne("tests/test_many.py", `${names.map((n) => `import ${n}`).join("\n")}\n`);
      expect(many.imports).toEqual(names.slice(0, 1000));

      const long = "a".repeat(501);
      const kept = "b".repeat(500);
      const sized = await indexOne("tests/test_long.py", `import ${long}\nimport ${kept}\nfrom ${kept} import c\n`);
      expect(sized.imports).toEqual([kept]);
    },
    SLOW,
  );
});
