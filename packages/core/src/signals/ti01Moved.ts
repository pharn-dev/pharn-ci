import type { DiffFile } from "../diff/unified.js";
import { isTestFile } from "../testFiles.js";
import { indexTestFile } from "../testIndex/indexTestFile.js";
import type { PythonTestIndex } from "../testIndex/pythonSides.js";
import type { TestBlock, TestIndexResult } from "../testIndex/types.js";
import type { TestSources } from "../testSources.js";
import {
  containsAtLeast,
  FOUR_FIFTHS,
  jaccardAtLeast,
  MAX_SIMILARITY_PROBES,
  SimilarityIndex,
  tokenSetMemo,
} from "./bodyTokens.js";
import type { MatchedPair } from "./testMatch.js";
import { fullTestName } from "./testName.js";
import { languageOf, type TouchedTests } from "./testPairs.js";
import { assertionChains, holdsEveryChain } from "./testSubjects.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const leafOf = (block: TestBlock): string => block.path[block.path.length - 1] ?? "";

/** The deleted test files whose every test moved, and each moved test paired with the new test that holds it. */
export interface MovedTests {
  files: Set<string>;
  /** Base path is the deleted file, head path the file that holds the test now; for TI05, TI06 and TI07. */
  pairs: MatchedPair[];
}

/** A new-at-head test with an assertion: a place a deleted test may have moved to. */
interface Fresh {
  path: string;
  block: TestBlock;
  used: boolean;
}

/**
 * The deleted test files whose tests moved, by name and by body. A file qualifies when the diff deletes it, its base text
 * was kept and indexed (JS/TS by the test index, Python by the Python index's base entries), it held at least one
 * test, every test's leaf name and every group name on its path are among the new-at-head tests with an assertion, and
 * every test is held by a distinct one of those tests: a body-token Jaccard of at least 4/5, or a body that holds at
 * least 4/5 of the deleted body's distinct tokens and every assertion chain it held. Tests of the same leaf name are
 * tried first (the first 256, head path then line), then a body-similarity probe over all of them (at most 256 posting
 * entries). The new-at-head tests are every test of an added test file and the tests of a compared file whose full name
 * is not at base. Empty when the touched files could not be compared (`touched.notRun`), when the base side of the
 * sources is unavailable, or when no deleted file qualifies; a deleted Python file needs the Python index. A name alone
 * never qualifies a file: the test's code has to be found again.
 */
export function movedTestFiles(
  diff: readonly DiffFile[],
  sources: TestSources,
  python: PythonTestIndex | undefined,
  touched: Pick<TouchedTests, "pairs" | "added" | "notRun">,
): MovedTests {
  const moved: MovedTests = { files: new Set(), pairs: [] };
  if (touched.notRun !== null || "unavailable" in sources.base) return moved;

  const deleted = diff
    .filter((file) => file.status === "deleted" && isTestFile(file.path) && file.binary !== true)
    .map((file) => file.path)
    .sort(byCodeUnit);
  if (deleted.length === 0) return moved;

  const fresh: Fresh[] = [];
  for (const file of touched.added) {
    for (const block of file.head)
      if (block.assertionCount >= 1) fresh.push({ path: file.headPath, block, used: false });
  }
  for (const file of touched.pairs) {
    const known = new Set(file.base.map(fullTestName));
    for (const block of file.head) {
      if (block.assertionCount >= 1 && !known.has(fullTestName(block))) {
        fresh.push({ path: file.headPath, block, used: false });
      }
    }
  }
  if (fresh.length === 0) return moved;
  fresh.sort((a, b) => byCodeUnit(a.path, b.path) || a.block.line - b.block.line);

  const leaves = new Map<string, Fresh[]>();
  const groups = new Set<string>();
  for (const entry of fresh) {
    const leaf = leafOf(entry.block);
    const list = leaves.get(leaf);
    if (list === undefined) leaves.set(leaf, [entry]);
    else list.push(entry);
    for (const group of entry.block.path.slice(0, -1)) groups.add(group);
  }

  const texts = new Map(sources.base.files.map((file) => [file.path, file.text]));
  const pythonBase = python?.available ? new Map(python.base.map((file) => [file.path, file.result])) : null;
  const named: Array<{ path: string; tests: TestBlock[] }> = [];
  for (const path of [...new Set(deleted)]) {
    const language = languageOf(path);
    let result: TestIndexResult | undefined;
    if (language === "py") result = pythonBase?.get(path);
    else if (language !== null) {
      const text = texts.get(path);
      if (text !== undefined) result = indexTestFile(path, text);
    }
    if (result === undefined || !result.parsed) continue;
    const tests = result.tests.filter((block) => block.kind === "test").sort((a, b) => a.line - b.line);
    if (tests.length === 0) continue;
    const reappears = tests.every(
      (block) => leaves.has(leafOf(block)) && block.path.slice(0, -1).every((group) => groups.has(group)),
    );
    if (reappears) named.push({ path, tests });
  }
  if (named.length === 0) return moved;

  const tokensOf = tokenSetMemo();
  const bodies = new SimilarityIndex(
    fresh.map((entry) => tokensOf(entry.block)),
    named.flatMap((file) => file.tests.map((block) => tokensOf(block))),
    FOUR_FIFTHS,
  );
  const holds = (block: TestBlock, entry: Fresh): boolean => {
    const before = tokensOf(block);
    const after = tokensOf(entry.block);
    return (
      jaccardAtLeast(before, after, FOUR_FIFTHS) ||
      (containsAtLeast(before, after, FOUR_FIFTHS) &&
        holdsEveryChain(assertionChains(block), assertionChains(entry.block)))
    );
  };

  for (const file of named) {
    const taken = new Set<Fresh>();
    const found: MatchedPair[] = [];
    for (const block of file.tests) {
      const free = (entry: Fresh) => !entry.used && !taken.has(entry);
      let pick =
        (leaves.get(leafOf(block)) ?? [])
          .slice(0, MAX_SIMILARITY_PROBES)
          .find((entry) => free(entry) && holds(block, entry)) ?? null;
      if (pick === null) {
        const at = bodies.find(tokensOf(block), (index) => !free(fresh[index] as Fresh)).index;
        if (at !== -1) pick = fresh[at] as Fresh;
      }
      if (pick === null) break;
      taken.add(pick);
      found.push({ basePath: file.path, headPath: pick.path, base: block, head: pick.block });
    }
    if (found.length !== file.tests.length) continue;
    for (const entry of taken) entry.used = true;
    moved.files.add(file.path);
    moved.pairs.push(...found);
  }
  return moved;
}
