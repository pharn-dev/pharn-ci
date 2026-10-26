import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// matchTests, indexTouchedTestFiles, the diff parser, the Python index and check() are loaded inside each test body:
// the AC tests are written before matchTests returns `moved`, so nothing the build changes may run while the file
// loads. The Python fixtures of TI02 and TI05 are indexed by the real interpreter, as the existing TI02/TI05 Python
// test does.
//
// What stays: for every TI02 and TI05 fixture, the TI02 and TI05 signals and messages check() gives in mode block with
// the fixture's test sources, as a digest taken at the base commit d73684d (sha256 of
// JSON.stringify({ signals, messages }) over the TI02/TI05 signals and the TEST_INTEGRITY_TI02/TI05 messages), with a
// readable summary beside it. What is new: `moved`, the cross-file matches, which only the two moved cases hold.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const SLOW = 60_000;

/**
 * The TI02 and TI05 case directories added after the base commit (the Python alias cases of py-parity-2); the digests
 * below were taken before they existed, so they are not in AT_BASE.
 */
const ADDED_AFTER_BASE: ReadonlySet<string> = new Set([
  "TI02/block-pytest-alias-marked-removed",
  "TI02/block-pytest-alias-marked-removed-literal",
  "TI02/pass-pytest-alias-fixture-removed",
  "TI02/pass-pytest-alias-fixture-removed-literal",
  "TI05/block-pytest-alias-raises-removed",
  "TI05/block-pytest-alias-raises-removed-literal",
  "TI05/pass-pytest-alias-emptied-skipped",
  "TI05/pass-pytest-alias-emptied-skipped-literal",
]);

/** [fixture, TI02/TI05 signals as "id severity path:line", their messages as "code level", digest] at d73684d. */
const AT_BASE: Array<[string, string[], string[], string]> = [
  [
    "TI02/block-common-leaf-elsewhere",
    ["TI02 block src/a.test.ts:4"],
    ["TEST_INTEGRITY_TI02 error"],
    "2fb7ebd760a82a941a8ae6c4bba022d22e64443f60e3f6a1f725108390e3c0a8",
  ],
  [
    "TI02/block-duplicate-name",
    ["TI02 block src/cart.test.ts:8"],
    ["TEST_INTEGRITY_TI02 error"],
    "daaa001c8a0a35677dcec6143f864612412ccd38bb2c71e954fc50caa12f51f9",
  ],
  [
    "TI02/block-pytest-removed",
    ["TI02 block py/test_total.py:4"],
    ["TEST_INTEGRITY_TI02 error"],
    "71c9292ca6b1b47d74d22028fd37b3849349b5a9bdd6f8f00292315902868838",
  ],
  [
    "TI02/block-removed-describe",
    ["TI02 block src/cart.test.ts:17", "TI02 block src/cart.test.ts:21", "TI02 block src/cart.test.ts:25"],
    ["TEST_INTEGRITY_TI02 error"],
    "4826e2616d88ddc3cee98a5bd7f2a07691a77200023f70662a11180f954339f6",
  ],
  [
    "TI02/block-removed-it",
    ["TI02 block src/cart.test.ts:9"],
    ["TEST_INTEGRITY_TI02 error"],
    "9773b9bbb366c8d9ed412bb3e0a322f41f7afd06ff6a788111c7dec255544362",
  ],
  [
    "TI02/block-renamed-file",
    ["TI02 block src/cart.test.ts:9"],
    ["TEST_INTEGRITY_TI02 error"],
    "9773b9bbb366c8d9ed412bb3e0a322f41f7afd06ff6a788111c7dec255544362",
  ],
  [
    "TI02/block-replaced-dissimilar",
    ["TI02 block src/cart.test.ts:9"],
    ["TEST_INTEGRITY_TI02 error"],
    "9773b9bbb366c8d9ed412bb3e0a322f41f7afd06ff6a788111c7dec255544362",
  ],
  [
    "TI02/block-unittest-method-removed",
    ["TI02 block py/test_cart.py:7"],
    ["TEST_INTEGRITY_TI02 error"],
    "6f6df99aaca3b6340cd4fb1b9a8027d8e08b7b19ce7e9c98b2ebccd2af4c7f4e",
  ],
  ["TI02/pass-became-todo", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI02/pass-body-rewritten", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI02/pass-deleted-file", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI02/pass-describe-renamed", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI02/pass-each-table-edited", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI02/pass-moved-in-file", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI02/pass-moved-to-added-file", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI02/pass-moved-to-other-file", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI02/pass-pytest-renamed", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI02/pass-renamed-edited-literal", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI02/pass-renamed-same-body", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI02/pass-template-renamed", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI02/pass-two-works-kept", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  [
    "TI02/warn-each-removed",
    ["TI02 warn src/cart.test.ts:8"],
    ["TEST_INTEGRITY_TI02 warn"],
    "3e4f667070193ccb0b21532260878f44b7f5a0db57687dfc6ec4c8cad9ccce7a",
  ],
  [
    "TI05/block-emptied",
    ["TI05 block src/cart.test.ts:13"],
    ["TEST_INTEGRITY_TI05 error"],
    "9b71a297ad0abfa008105ac58e3f45cf7065c14363cf65e4fdbbc611235b03e1",
  ],
  [
    "TI05/block-guard-only",
    ["TI05 block src/cart.test.ts:13"],
    ["TEST_INTEGRITY_TI05 error"],
    "9b71a297ad0abfa008105ac58e3f45cf7065c14363cf65e4fdbbc611235b03e1",
  ],
  [
    "TI05/block-pytest-emptied",
    ["TI05 block py/test_total.py:4"],
    ["TEST_INTEGRITY_TI05 error"],
    "1132590303e1e0ee6aec7654b01b7df0fe586c6333e6b6fdbb4cd9511207f17b",
  ],
  ["TI05/pass-became-skip", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI05/pass-became-todo", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI05/pass-count-grows", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI05/pass-fewer-rewritten", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI05/pass-none-at-base", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  ["TI05/pass-removed-with-rewrite", [], [], "34f6882b1f82977bda289fffb5b7a1fd4133c35bdb3dd7f189878e54bf9e3e55"],
  [
    "TI05/warn-helper-assert",
    ["TI05 warn src/cart.test.ts:9"],
    ["TEST_INTEGRITY_TI05 warn"],
    "6ba9a10e20ad839ac272c24650499eb925ebddefd9bbca3edd959d03c1a27674",
  ],
  [
    "TI05/warn-helper-check",
    ["TI05 warn src/cart.test.ts:9"],
    ["TEST_INTEGRITY_TI05 warn"],
    "7e13736d577396e2df1314106fd6c424a8cba307d1112ec48d6572b1e82c7ae1",
  ],
  [
    "TI05/warn-helper-expect",
    ["TI05 warn src/cart.test.ts:9"],
    ["TEST_INTEGRITY_TI05 warn"],
    "b066de827b3f40b12fa80948df85f4b9adb2a151b9b3e90612bfa3f11d24c8e3",
  ],
  [
    "TI05/warn-helper-this-verify",
    ["TI05 warn src/cart.test.ts:9"],
    ["TEST_INTEGRITY_TI05 warn"],
    "88fc8c47da46854d293476967a820c2d0515792b235564af6233f4ead4b35b5d",
  ],
  [
    "TI05/warn-one-removed",
    ["TI05 warn src/cart.test.ts:9"],
    ["TEST_INTEGRITY_TI05 warn"],
    "fc0c6e9bd1614fd09cb4421cdeb050443bc2c8a0e16af86a2bfb0507505d1983",
  ],
];

/** The cross-file moves the two moved cases hold, as "base path › base name -> head path › head name". */
const MOVED: Record<string, string[]> = {
  "TI02/pass-moved-to-other-file": ["src/a.test.ts › totals the cart -> src/b.test.ts › totals the cart"],
  "TI02/pass-moved-to-added-file": ["src/a.test.ts › totals the cart -> src/c.test.ts › sums the cart"],
};

interface SourceFile {
  path: string;
  text: string;
}
interface Block {
  name: string;
  path: string[];
}
interface Pair {
  basePath: string;
  headPath: string;
  base: Block;
  head: Block;
}
interface Match {
  unmatched: unknown[];
  pairs: Pair[];
  moved?: Pair[];
}
interface Report {
  testIntegrity: { signals: { id: string; severity: string; path: string; line: number | null }[] };
  messages: { code: string; level: string; text: string }[];
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function sideFiles(dir: string): SourceFile[] {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

async function runFixture(name: string): Promise<{ match: Match; report: Report }> {
  const root = `${FIXTURES}test-integrity/${name}/`;
  const diffText = readFileSync(`${root}change.diff`, "utf8");
  const base = sideFiles(`${root}base`);
  const head = sideFiles(`${root}head`);
  const sources = { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } };

  const io = (await import("../src/index.js")) as unknown as {
    indexPythonTestSources(sources: unknown): Promise<{ available: boolean } | undefined>;
  };
  const pythonTestIndex = await io.indexPythonTestSources(sources);
  if (name.includes("pytest") || name.includes("unittest")) {
    expect(pythonTestIndex?.available, "the Python index ran with the real interpreter").toBe(true);
  }

  const core = (await import("@pharn-ci/core")) as unknown as { parseUnifiedDiff(text: string): unknown[] };
  const pairsModule = (await import("../../core/src/signals/testPairs.js")) as unknown as {
    indexTouchedTestFiles(diff: unknown[], sources: unknown, python: unknown): unknown;
  };
  const matchModule = (await import("../../core/src/signals/testMatch.js")) as unknown as {
    matchTests(touched: unknown): Match;
  };
  const touched = pairsModule.indexTouchedTestFiles(core.parseUnifiedDiff(diffText), sources, pythonTestIndex);
  const match = matchModule.matchTests(touched);

  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diffText },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources: sources,
    pythonTestIndex,
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]) as unknown as Report;
  expectValidReport(report);
  return { match, report };
}

const describePair = (p: Pair) =>
  `${p.basePath} › ${p.base.path.join(" › ")} -> ${p.headPath} › ${p.head.path.join(" › ")}`;

describe("matchTests gains `moved`, and TI02 and TI05 keep their results", () => {
  for (const [name, signals, messages, digest] of AT_BASE) {
    const moved = MOVED[name] ?? [];
    it(
      `AC-6: ${name} has ${moved.length === 0 ? "no cross-file match in" : "its cross-file match in"} moved, and the TI02 and TI05 signals and messages it gave at the base commit`,
      async () => {
        const { match, report } = await runFixture(name);
        expect(Array.isArray(match.moved), "matchTests returns a moved list").toBe(true);
        const list = match.moved ?? [];
        for (const pair of list) expect(pair.basePath, "a cross-file match").not.toBe(pair.headPath);
        expect(list.map(describePair)).toEqual(moved);
        for (const pair of list) {
          expect(
            match.pairs.some((p) => p.basePath === pair.basePath && p.base === pair.base),
            "a moved base test is not also a pair",
          ).toBe(false);
        }

        const kept = report.testIntegrity.signals.filter((s) => ["TI02", "TI05"].includes(String(s.id)));
        const keptMessages = report.messages.filter((m) =>
          ["TEST_INTEGRITY_TI02", "TEST_INTEGRITY_TI05"].includes(String(m.code)),
        );
        expect(kept.map((s) => `${s.id} ${s.severity} ${s.path}:${s.line}`)).toEqual(signals);
        expect(keptMessages.map((m) => `${m.code} ${m.level}`)).toEqual(messages);
        expect(
          createHash("sha256")
            .update(JSON.stringify({ signals: kept, messages: keptMessages }))
            .digest("hex"),
          "the full signals and messages are those of the base commit",
        ).toBe(digest);
      },
      SLOW,
    );
  }

  it(
    "AC-6: the cases checked are every case under fixtures/test-integrity/TI02/ and TI05/, and the moved cases hold a moved list",
    async () => {
      const listed = ["TI02", "TI05"].flatMap((dir) =>
        readdirSync(`${FIXTURES}test-integrity/${dir}`)
          .sort()
          .map((n) => `${dir}/${n}`)
          .filter((name) => !ADDED_AFTER_BASE.has(name)),
      );
      expect(AT_BASE.map(([name]) => name)).toEqual(listed);
      for (const name of Object.keys(MOVED)) {
        expect(listed).toContain(name);
        const { match } = await runFixture(name);
        expect(match.moved?.length, `${name}: one cross-file match`).toBe(1);
      }
    },
    SLOW,
  );
});
