import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// indexPythonTests is loaded inside the test body: the AC test is written before the Python index resolves aliases, so
// nothing the build adds may run while the file loads. Both fixtures are written by the build, so the test first
// checks that the aliased one holds every form AC-8 lists and that the literal twin has the same line layout, and that
// the literal twin's index carries each modifier, fixture and assertion kind today's index gives literal spellings.
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
type Block = {
  kind: string;
  name: string;
  line: number;
  modifiers: string[];
  assertionCount: number;
  assertions: Assertion[];
};
type Result = { parsed: true; tests: Block[]; mocks: unknown[] } | { parsed: false; reason: string };
type Run = { available: true; files: { path: string; result: Result }[] } | { available: false; reason: string };

async function indexOne(path: string, text: string): Promise<Block[]> {
  const io = (await import("../src/index.js")) as unknown as {
    indexPythonTests: (files: { path: string; text: string }[]) => Promise<Run>;
  };
  const run = await io.indexPythonTests([{ path, text }]);
  if (!run.available) throw new Error(`the run is unavailable: ${JSON.stringify(run)}`);
  const result = (run.files[0] as { result: Result }).result;
  if (!result.parsed) throw new Error(`expected an index, got the refusal ${JSON.stringify(result)}`);
  return result.tests;
}

/** What AC-8 compares per block: everything that does not depend on spelling. */
const shape = (b: Block) => ({
  kind: b.kind,
  name: b.name,
  line: b.line,
  modifiers: b.modifiers,
  assertionCount: b.assertionCount,
  chains: b.assertions.map((a) => a.chain),
});

/** The forms the aliased fixture must hold, as text. */
const ALIAS_FORMS = [
  '@pt.mark.skip(reason="r")',
  "@m.skipif(",
  '@m.xfail(reason="r")',
  "@m.xfail(",
  "@pt.mark.parametrize(",
  "@fx\n",
  '@fx(scope="module")',
  "@si(",
  "@su(",
  "@ef\n",
  'sk("r")',
  'xf("r")',
  "with raises(ValueError):",
  "with pt.warns(UserWarning):",
  'pt.fail("r")',
  "ax(",
];

describe("the Python index resolves pytest and unittest aliases from top-level imports", () => {
  it(
    "AC-8: every test of the aliased fixture has the modifiers, the fixture-or-test kind, the in-body skip or xfail and the count and kind of each assertion of its literal twin",
    async () => {
      requirePython();
      const alias = fixture("test_aliases.py.txt");
      const literal = fixture("test_aliases_literal.py.txt");

      // The aliased fixture: its three import lines first, then every form AC-8 lists.
      const aliasLines = alias.split("\n");
      expect(aliasLines.slice(0, 3)).toEqual([
        "import pytest as pt",
        "from pytest import mark as m, fixture as fx, raises, approx as ax, skip as sk, xfail as xf",
        "from unittest import skipIf as si, skipUnless as su, expectedFailure as ef",
      ]);
      for (const form of ALIAS_FORMS)
        expect(alias, `the aliased fixture holds ${JSON.stringify(form)}`).toContain(form);
      expect(alias, "an xfail with a condition").toMatch(/@m\.xfail\([^"')][^)]*,\s*reason=/);
      expect(alias, "@fx on def test_resource").toMatch(/@fx\n\s*def test_resource\(/);
      expect(alias, '@fx(scope="module") on def config').toMatch(/@fx\(scope="module"\)\n\s*def config\(/);

      // The literal twin: the same layout, the literal spellings, no alias binding.
      const literalLines = literal.split("\n");
      expect(literalLines.length, "the same number of lines").toBe(aliasLines.length);
      expect(literalLines.slice(0, 3)).toEqual(["import pytest", "import unittest", ""]);
      expect(literal, "no alias binding").not.toMatch(/^(?:import|from)\s.*\bas\s/m);
      const defs = (lines: string[]) =>
        lines.flatMap((l, i) => {
          const m = /^\s*(?:async\s+)?(?:def|class)\s+(\w+)/.exec(l);
          return m === null ? [] : [`${i + 1}:${m[1]}`];
        });
      expect(defs(literalLines), "every def and class at the same line").toEqual(defs(aliasLines));

      const literalIndex = await indexOne("tests/test_aliases.py", literal);
      // The literal twin carries what AC-8 compares, so an equal aliased index has resolved every alias.
      const modifiers = new Set(literalIndex.flatMap((b) => b.modifiers));
      for (const m of ["skip", "skipIf", "fails", "each", "runIf"])
        expect(modifiers, `a block carries ${m}`).toContain(m);
      const hooks = literalIndex.filter((b) => b.kind === "hook").map((b) => b.name);
      expect(hooks, "test_resource and config are fixtures").toEqual(
        expect.arrayContaining(["test_resource", "config"]),
      );
      const chains = new Set(literalIndex.flatMap((b) => b.assertions.map((a) => a.chain)));
      for (const c of ["pytest.raises()", "pytest.warns()", "pytest.fail()", "assert approx"]) {
        expect(chains, `an assertion of kind ${c}`).toContain(c);
      }

      const aliasIndex = await indexOne("tests/test_aliases.py", alias);
      expect(aliasIndex.map(shape), "each block equals its literal twin's").toEqual(literalIndex.map(shape));
    },
    SLOW,
  );
});
