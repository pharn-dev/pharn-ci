import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// indexPythonTests is loaded inside the test body: the AC test is written before the Python index resolves aliases, so
// nothing the build adds may run while the file loads. The three alias fixtures are written by the build, so the test
// first checks that each holds the forms AC-9 names, and finds each block's decorators from the fixture text itself.
// Each fixture also holds a control, `import pytest as ok` with `@ok.mark.skip`, which gives `skip` only once the index
// resolves aliases. test_marks.py and its golden are the existing ones: every bare name matched before still matches.
// The real interpreter runs; with no python3 of 3.8 or newer on PATH the test fails with that reason, never skips.

const SLOW = 60_000;
const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/py-index/${name}`, import.meta.url), "utf8");

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

type Assertion = { chain: string; line: number };
type Mock = { callee: string; specifier: string | null; line: number };
type Block = {
  kind: string;
  name: string;
  line: number;
  modifiers: string[];
  assertionCount: number;
  assertions: Assertion[];
};
type Index = { parsed: true; syntaxErrors: number; tests: Block[]; mocks: Mock[] };
type Result = Index | { parsed: false; reason: string };
type Run = { available: true; files: { path: string; result: Result }[] } | { available: false; reason: string };

async function indexResult(path: string, text: string): Promise<Result> {
  const io = (await import("../src/index.js")) as unknown as {
    indexPythonTests: (files: { path: string; text: string }[]) => Promise<Run>;
  };
  const run = await io.indexPythonTests([{ path, text }]);
  if (!run.available) throw new Error(`the run is unavailable: ${JSON.stringify(run)}`);
  return (run.files[0] as { result: Result }).result;
}

async function indexOne(path: string, text: string): Promise<Index> {
  const result = await indexResult(path, text);
  if (!result.parsed) throw new Error(`expected an index, got the refusal ${JSON.stringify(result)}`);
  expect(result.syntaxErrors, `${path} parses`).toBe(0);
  return result;
}

/** Each `def` of the text with its 1-based line and the single-line decorators directly above it, trimmed. */
function defsOf(text: string): { name: string; line: number; decorators: string[] }[] {
  const lines = text.split("\n");
  const out: { name: string; line: number; decorators: string[] }[] = [];
  lines.forEach((l, i) => {
    const m = /^(\s*)(?:async\s+)?def\s+(\w+)\(/.exec(l);
    if (m === null) return;
    const decorators: string[] = [];
    for (let k = i - 1; k >= 0; k--) {
      const p = lines[k] as string;
      if (!p.startsWith(`${m[1]}@`)) break;
      decorators.unshift(p.trim());
    }
    out.push({ name: m[2] as string, line: i + 1, decorators });
  });
  return out;
}

const CONTROL_IMPORT = /^import pytest as ok$/m;
const CONTROL = "@ok.mark.skip";
const PYTEST_CHAINS = ["pytest.raises()", "pytest.warns()", "pytest.fail()", "assert approx"];

/** The control block: the one def decorated `@ok.mark.skip`; its index block must carry `skip`. */
function expectControl(label: string, text: string, index: Index): Block {
  expect(text, `${label}: the control's import`).toMatch(CONTROL_IMPORT);
  const controls = defsOf(text).filter((d) => d.decorators.includes(CONTROL));
  expect(controls, `${label}: one def decorated ${CONTROL}`).toHaveLength(1);
  const control = controls[0] as { name: string; line: number };
  const block = index.tests.find((b) => b.name === control.name && b.line === control.line);
  expect(block, `${label}: the control block ${control.name}`).toBeDefined();
  expect(block?.modifiers, `${label}: ${CONTROL} resolves through import pytest as ok`).toContain("skip");
  return block as Block;
}

describe("the Python index: shadowed and unresolved bindings, aliased mock callees, and the bare names it matched before", () => {
  it(
    "AC-9: @pytest.mark.skip under import foo as pytest still gives skip; aliases bound inside if/try/a function, by import *, by assignment or replaced by a later import add nothing; an aliased mock callee gives no mock entry; test_marks.py still gives its golden",
    async () => {
      requirePython();

      // 1. The shadowed module name: the literal spelling still matches.
      {
        const text = fixture("test_alias_shadowed.py.txt");
        expect(text, "import foo as pytest").toMatch(/^import foo as pytest$/m);
        const index = await indexOne("tests/test_alias_shadowed.py", text);
        expectControl("shadowed", text, index);
        const shadowed = defsOf(text).filter((d) => d.decorators.some((x) => x.startsWith("@pytest.mark.skip")));
        expect(shadowed, "a def decorated @pytest.mark.skip").toHaveLength(1);
        const block = index.tests.find((b) => b.name === shadowed[0]?.name);
        expect(block?.modifiers, "@pytest.mark.skip under import foo as pytest gives skip").toContain("skip");
      }

      // 2. The unresolved forms: nothing but the control gains a modifier, a fixture or a pytest assertion.
      {
        const text = fixture("test_alias_unresolved.py.txt");
        const forms: [string, RegExp][] = [
          ["an import inside an if", /^if\b[^\n]*:\n\s+import pytest as \w+$/m],
          ["an import inside a try", /^try:\n\s+import pytest as \w+$/m],
          ["an import inside a function", /^def \w+\([^\n]*:\n(?:\s[^\n]*\n)*?\s+import pytest as \w+$/m],
          ["from pytest import *", /^from pytest import \*$/m],
          ["sm = pytest.mark.skip then @sm", /^sm = pytest\.mark\.skip$[\s\S]*^@sm$/m],
          ["import pytest as pt replaced by import os as pt", /^import pytest as pt$[\s\S]*^import os as pt$/m],
          ["@pt.mark.skip through the replaced name", /^@pt\.mark\.skip/m],
          ["pt.fixture through the replaced name", /pt\.fixture/],
          ["pt.raises through the replaced name", /pt\.raises\(/],
          ["pt.approx through the replaced name", /pt\.approx\(/],
          ['xfail("r") under import *', /^\s+xfail\("r"\)$/m],
        ];
        for (const [form, pattern] of forms) expect(text, `the fixture holds ${form}`).toMatch(pattern);
        const index = await indexOne("tests/test_alias_unresolved.py", text);
        const control = expectControl("unresolved", text, index);
        const others = index.tests.filter((b) => b !== control);
        expect(others.length, "the unresolved forms are indexed as blocks").toBeGreaterThan(0);
        for (const b of others) {
          expect(b.modifiers, `${b.name}: no modifier`).toEqual([]);
          expect(b.kind, `${b.name}: not a fixture`).not.toBe("hook");
          for (const a of b.assertions) expect(PYTEST_CHAINS, `${b.name}: no pytest assertion`).not.toContain(a.chain);
        }
      }

      // 3. An aliased mock callee: the same mock entries as today, none.
      {
        const text = fixture("test_alias_mock.py.txt");
        expect(text, "from unittest import mock as mk").toMatch(/^from unittest import mock as mk$/m);
        expect(text, 'mk.patch("app.total")').toContain('mk.patch("app.total")');
        const index = await indexOne("tests/test_alias_mock.py", text);
        expectControl("mock", text, index);
        expect(index.mocks, "no mock entry for mk.patch").toEqual([]);
      }

      // 4. The bare names the index matched before: test_marks.py gives its committed golden.
      {
        const golden = JSON.parse(fixture("test_marks.index.json")) as unknown;
        expect(await indexResult("tests/test_marks.py", fixture("test_marks.py.txt"))).toStrictEqual(golden);
      }
    },
    SLOW,
  );
});
