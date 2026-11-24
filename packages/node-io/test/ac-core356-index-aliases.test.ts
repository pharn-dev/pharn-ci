import { spawnSync } from "node:child_process";
import type { PythonIndexFile } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";

// CORE-356 (AC-9). The Python index reports, per parsed file, the alias bindings of the module's top-level `import`
// and `from … import` statements as `aliases`: `[local, target]` pairs. A binding inside an `if` is not top-level, and
// an identity binding (`import os`) adds nothing. indexPythonTests is loaded inside the test body, so nothing the build
// changes runs while the file loads. The real interpreter runs; with no python3 of 3.8 or newer on PATH the test fails
// with that reason, never skips.

const SLOW = 60_000;

/** The python3 on PATH and whether it is 3.8 or newer, decided once while the file loads (no build code runs). */
const PYTHON = (() => {
  const run = spawnSync("python3", ["-c", "import sys; print(sys.version_info >= (3, 8), sys.version.split()[0])"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const [ok, version] = (run.stdout ?? "").trim().split(" ");
  return { ok: run.status === 0 && ok === "True", version: version ?? "", error: run.error?.message ?? "" };
})();

/** Fails the test, with the reason, when no python3 of 3.8 or newer is on PATH. */
function requirePython(): void {
  if (!PYTHON.ok) {
    throw new Error(
      `this test needs python3 3.8 or newer on PATH and found ${PYTHON.version === "" ? `none (${PYTHON.error || "python3 did not run"})` : `python3 ${PYTHON.version}`}`,
    );
  }
}

const TEXT = `import pytest as pt
from unittest import skip as sk
import os

if os.environ.get("CI"):
    import pytest as q


def test_total():
    assert 2 + 3 == 5


@sk("r")
def test_empty():
    assert [] == []
`;

describe("CORE-356: the Python index reports the top-level alias bindings of a test file", () => {
  it(
    "AC-9: a .py test file binding import pytest as pt, from unittest import skip as sk and import os at module level, and import pytest as q inside an if, gets an index entry whose aliases map pt to pytest and sk to unittest.skip, and map neither os nor q",
    async () => {
      requirePython();
      const { indexPythonTests } = await import("../src/index.js");
      const run = await indexPythonTests([{ path: "tests/test_aliases.py", text: TEXT }]);
      if (!run.available) throw new Error(`the Python index is unavailable: ${run.reason} (${run.detail})`);
      const [file] = run.files;
      if (file === undefined) throw new Error("the run gave no file");
      const entry: PythonIndexFile = file;
      expect(entry.result.parsed, "the file is indexed").toBe(true);

      const aliases = "aliases" in entry ? entry.aliases : undefined;
      expect(Array.isArray(aliases), `the entry carries aliases (got ${JSON.stringify(aliases)})`).toBe(true);
      const pairs = (Array.isArray(aliases) ? aliases : []) as unknown[];
      for (const pair of pairs) {
        expect(
          Array.isArray(pair) && pair.length === 2,
          `each alias is a [local, target] pair: ${JSON.stringify(pair)}`,
        ).toBe(true);
      }
      const locals = pairs.map((p) => (p as [string, string])[0]);
      expect(pairs, "pt maps to pytest").toContainEqual(["pt", "pytest"]);
      expect(pairs, "sk maps to unittest.skip").toContainEqual(["sk", "unittest.skip"]);
      expect(locals, "os is not mapped").not.toContain("os");
      expect(locals, "q, bound inside an if, is not mapped").not.toContain("q");
    },
    SLOW,
  );
});
