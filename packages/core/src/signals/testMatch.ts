import type { TestBlock } from "../testIndex/types.js";
import { byCodeUnit } from "../text.js";
import {
  containsAtLeast,
  FOUR_FIFTHS,
  HALF,
  jaccardAtLeast,
  MAX_SIMILARITY_PROBES,
  tokenSetMemo,
} from "./bodyTokens.js";
import { fullNameWords } from "./nameWords.js";
import { eachReplacements, holdsBody, renameInPlace } from "./sameGroupRules.js";
import { fullTestName } from "./testName.js";
import type { TouchedTests } from "./testPairs.js";
import { assertionChains, holdsEveryChain } from "./testSubjects.js";

/** A base test with no counterpart at head: TI02 reports it. `path` is the base path. */
export interface MatchCandidate {
  path: string;
  block: TestBlock;
}

/** A base test and the head test that stands for it: TI05 reads these. */
export interface MatchedPair {
  basePath: string;
  headPath: string;
  base: TestBlock;
  head: TestBlock;
}

/** One deleted test file, indexed at the merge base: its tests in line order and its `describe` blocks. */
export interface DeletedTestFile {
  path: string;
  tests: TestBlock[];
  groups: TestBlock[];
}

/**
 * The deleted test files the diff shows, indexed (see `indexDeletedTestFiles`), in path order, and the ones among them
 * for which the diff also adds a test file, or renames to one, of the same stem: those need no name check.
 */
export interface DeletedTestFiles {
  files: readonly DeletedTestFile[];
  stemLinked: ReadonlySet<string>;
}

/** What the moved-file rule found: the deleted test files whose tests moved to other files. */
export interface MovedFiles {
  /** The deleted files whose every test is held by a distinct new test. */
  moved: Set<string>;
  /** Every path in `deleted.files`: the files whose base text was indexed, qualifying or not. */
  compared: Set<string>;
  /** Base path is the deleted file, head path the file that holds the test now; for TI05, TI06 and TI07. */
  pairs: MatchedPair[];
}

export interface TestMatch {
  /** Candidates no rule cleared, in base-path then base-line order. */
  unmatched: MatchCandidate[];
  /** The name pairs, the same-file body pairs and the renames in place. A cross-file match is listed in `moved`, not here. */
  pairs: MatchedPair[];
  /** The cross-file matches: a base test and the new-at-head test of another file that cleared it. */
  moved: MatchedPair[];
  /**
   * The `.each` replacements: a base test and the new-at-head `.each` test of its file and group that cleared it. One
   * `.each` test may appear for several base tests. Not in `pairs`, so no signal that reads pairs reads an `.each` table.
   */
  replaced: MatchedPair[];
  /** The deleted test files whose tests moved (the last rule); empty when no deleted files were given. */
  movedFiles: MovedFiles;
}

const byLine = (a: TestBlock, b: TestBlock) => a.line - b.line;

/** A test that is new at head: it has no base test of its name, or its name is computed. */
interface NewHead {
  fileIndex: number;
  path: string;
  block: TestBlock;
  /** Position in the order of head path, then line, over every new-at-head test. */
  order: number;
  used: boolean;
}

interface Candidate {
  fileIndex: number;
  path: string;
  block: TestBlock;
}

/** What `FreeList` needs of an entry: the file it belongs to, and whether it is already paired. */
interface Listed {
  fileIndex: number;
  used: boolean;
}

const leafName = (block: TestBlock): string => block.path[block.path.length - 1] ?? "";

interface WalkOptions<E> {
  /** Entries of this file are skipped, and not counted. */
  own?: number;
  /** The walk stops at this index. */
  before?: number;
  /** The most entries offered to `test`, `held` ones included (default `MAX_SIMILARITY_PROBES`). */
  limit?: number;
  /** Entries that count against the limit but are not offered to `test`. */
  held?: ReadonlySet<E>;
  test: (entry: E) => boolean;
}

/**
 * A list of entries in head order, walked by one bounded loop used by every rule that compares bodies or names. The
 * walk returns the first entry at or after the start, in head order, that is not used, is outside file `own` and passes
 * `test`. At most `limit` entries are offered; used entries and entries of file `own` are skipped and not counted.
 *
 * Two arrays of the list keep the skipping cheap. `next` is a path-halving "next free index": used flags only ever go
 * from false to true, so a pointer past a used entry stays valid, and a scan does not step over the entries already
 * paired again and again. `runEnd` is the end of each file's run of entries (head paths are distinct, so a file's
 * entries are adjacent), which jumps over the candidate's own file in one step. Both are built on the first walk.
 */
class FreeList<E extends Listed> {
  private next: Int32Array | undefined;
  private runEnd: Int32Array | undefined;

  constructor(private readonly entries: readonly E[]) {}

  private build(): { next: Int32Array; runEnd: Int32Array } {
    if (this.next === undefined || this.runEnd === undefined) {
      const n = this.entries.length;
      const next = new Int32Array(n + 1);
      const runEnd = new Int32Array(n + 1);
      for (let i = 0; i <= n; i++) next[i] = i;
      runEnd[n] = n;
      for (let i = n - 1; i >= 0; i--) {
        const following = this.entries[i + 1];
        runEnd[i] =
          following !== undefined && following.fileIndex === (this.entries[i] as E).fileIndex
            ? (runEnd[i + 1] as number)
            : i + 1;
      }
      this.next = next;
      this.runEnd = runEnd;
    }
    return { next: this.next, runEnd: this.runEnd };
  }

  /** The first index at or after `from` whose entry is not used (the length of the list when there is none). */
  private find(next: Int32Array, from: number): number {
    const n = this.entries.length;
    let root = from;
    while (root < n && ((next[root] as number) !== root || (this.entries[root] as E).used)) {
      if ((next[root] as number) === root) next[root] = root + 1;
      root = next[root] as number;
    }
    let step = from;
    while (step < root) {
      const following = next[step] as number;
      next[step] = root;
      step = following;
    }
    return root;
  }

  walk(options: WalkOptions<E>): E | null {
    const n = this.entries.length;
    if (n === 0) return null;
    const { next, runEnd } = this.build();
    const before = Math.min(options.before ?? n, n);
    const limit = options.limit ?? MAX_SIMILARITY_PROBES;
    let offered = 0;
    let at = this.find(next, 0);
    while (at < before) {
      const entry = this.entries[at] as E;
      if (entry.fileIndex === options.own) {
        at = this.find(next, runEnd[at] as number);
        continue;
      }
      if (++offered > limit) return null;
      if (!options.held?.has(entry) && options.test(entry)) return entry;
      at = this.find(next, at + 1);
    }
    return null;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/** A memo of `compute` per test block. The values must not be changed. */
function memoOf<V>(compute: (block: TestBlock) => V): (block: TestBlock) => V {
  const memo = new Map<TestBlock, V>();
  return (block) => {
    let found = memo.get(block);
    if (found === undefined) {
      found = compute(block);
      memo.set(block, found);
    }
    return found;
  };
}

const NO_WORDS: ReadonlySet<string> = new Set();

/** A place a deleted test may have moved to: a new-at-head test with an assertion. */
interface PoolEntry extends Listed {
  path: string;
  block: TestBlock;
}

/**
 * The moved-file rule. A deleted test file qualifies when it held at least one test, every test's leaf name and every
 * group name on its path are among the new-at-head tests with an assertion (not needed for a stem-linked file), and
 * every test is held by a distinct one of those tests: the first of the first 256 entries of its leaf name's list that
 * is free and holds it (`holdsBody`), else the first of the not-yet-paired ones, in head order, with a body-token
 * Jaccard of at least 4/5, the walk offering at most 256 entries. An entry this deleted file already took counts against
 * the 256 and is not offered (a file that fails gives its entries back, so they cannot be skipped for good). The new
 * tests are every test with an assertion of an added file and of a compared file whose full name is not at base. The
 * pool and its used flags are the rule's own: it never reads what the other rules paired.
 */
function matchDeletedFiles(
  touched: Pick<TouchedTests, "pairs" | "added">,
  deleted: DeletedTestFiles,
  tokensOf: (block: TestBlock) => ReadonlySet<string>,
): MovedFiles {
  const result: MovedFiles = {
    moved: new Set(),
    compared: new Set(deleted.files.map((file) => file.path)),
    pairs: [],
  };
  if (!deleted.files.some((file) => file.tests.length > 0)) return result;

  const pool: PoolEntry[] = [];
  for (const file of touched.added) {
    for (const block of file.head) {
      if (block.assertionCount >= 1) pool.push({ fileIndex: 0, path: file.headPath, block, used: false });
    }
  }
  for (const file of touched.pairs) {
    const known = new Set(file.base.map(fullTestName));
    for (const block of file.head) {
      if (block.assertionCount >= 1 && !known.has(fullTestName(block))) {
        pool.push({ fileIndex: 0, path: file.headPath, block, used: false });
      }
    }
  }
  if (pool.length === 0) return result;
  pool.sort((a, b) => byCodeUnit(a.path, b.path) || a.block.line - b.block.line);

  const leaves = new Map<string, PoolEntry[]>();
  const groups = new Set<string>();
  for (const entry of pool) {
    push(leaves, leafName(entry.block), entry);
    for (const group of entry.block.path.slice(0, -1)) groups.add(group);
  }

  const list = new FreeList(pool);
  for (const file of deleted.files) {
    if (file.tests.length === 0) continue;
    // A stem-linked file (a test file of the same name is added) needs no name check: the body evidence decides.
    if (
      !deleted.stemLinked.has(file.path) &&
      !file.tests.every(
        (block) => leaves.has(leafName(block)) && block.path.slice(0, -1).every((group) => groups.has(group)),
      )
    ) {
      continue;
    }
    const taken = new Set<PoolEntry>();
    const found: MatchedPair[] = [];
    for (const block of file.tests) {
      let pick: PoolEntry | null = null;
      const sameLeaf = leaves.get(leafName(block)) ?? [];
      const scan = Math.min(sameLeaf.length, MAX_SIMILARITY_PROBES);
      for (let at = 0; at < scan; at++) {
        const entry = sameLeaf[at] as PoolEntry;
        if (!entry.used && !taken.has(entry) && holdsBody(block, entry.block, tokensOf)) {
          pick = entry;
          break;
        }
      }
      if (pick === null) {
        const tokens = tokensOf(block);
        pick = list.walk({ held: taken, test: (entry) => jaccardAtLeast(tokens, tokensOf(entry.block), FOUR_FIFTHS) });
      }
      if (pick === null) break;
      taken.add(pick);
      found.push({ basePath: file.path, headPath: pick.path, base: block, head: pick.block });
    }
    if (found.length !== file.tests.length) continue;
    for (const entry of taken) entry.used = true;
    result.moved.add(file.path);
    result.pairs.push(...found);
  }
  return result;
}

/**
 * Matches the tests of the touched test files between base and head. Only tests (kind `test`) count.
 *
 * Per compared file the static names are compared as multisets, pairing base and head instances in line order; the
 * excess base instances (highest lines) are candidates and the excess head instances are new at head. A test whose name
 * is computed never takes part in name matching: on base it is always a candidate, on head always new. Every test of an
 * added file is new at head.
 *
 * The rules run in this order. Every threshold is an integer comparison. Each rule compares a removed test with at most
 * 256 not-yet-paired new tests, in head order (`FreeList`): a match past the bound is not found, and the removed test is
 * reported.
 *
 * 1. Phase 1, per file in base-path order, each candidate in base-line order takes the first unused new-at-head test of
 *    its own file with an equal body hash or a token-set Jaccard of at least 4/5 (a pair). The first one with the same
 *    body hash is found without the bound; a similar one before it, within the bound, is preferred.
 * 2. R1, rename in place, per file and group (the exact names of the enclosing blocks): when a group has as many
 *    candidates left as unused new-at-head tests, the i-th of each, in line order, are a pair when the body-token
 *    Jaccard is at least 1/2 and the new body holds at least 3/4 of the old body's distinct tokens.
 * 3. R2, `.each` replacement, per file and group: a candidate with an assertion is cleared by the first of the first
 *    256 not-yet-paired new-at-head `.each` tests that shares a subject with it and holds every assertion chain it
 *    held. That is listed in `replaced`, not `pairs`; the `.each` test counts as used from then on.
 * 4. Phase 2, over what is left, each candidate takes the first unused new-at-head test of another touched file (head
 *    path, then line) with the same body hash, or with the same leaf name and a body that holds it: the first of the
 *    first 256 entries of that leaf's list with a body-token Jaccard of at least 4/5, or a body that holds at least 4/5
 *    of the candidate's distinct tokens and every assertion chain it held. Of the two the earlier one in head order
 *    wins. That only clears the candidate (`moved`).
 * 5. R3, cross-file similarity, over what is left: the first unused new-at-head test of another touched file with a
 *    body-token Jaccard of at least 4/5; else the first whose full-name words have a Jaccard of at least 1/2, whose
 *    body holds at least 4/5 of the candidate's distinct body tokens and every assertion chain the candidate held.
 *    That also only clears the candidate (`moved`).
 * 6. The moved-file rule, with the indexed tests of the deleted files, on its own pool of new tests with an assertion:
 *    see `matchDeletedFiles`. Its result is `movedFiles`; it never changes the other lists.
 *
 * Every rule needs the test's code to survive: a name alone (the part a change controls most easily) never clears or
 * softens a candidate here.
 *
 * A new-at-head test answers at most one candidate, except an `.each` test, which may clear several.
 */
export function matchTests(touched: Pick<TouchedTests, "pairs" | "added">, deleted?: DeletedTestFiles): TestMatch {
  const pairs: MatchedPair[] = [];
  const replaced: MatchedPair[] = [];
  const fresh: NewHead[] = [];
  const left: Candidate[] = [];
  const tokensOf = tokenSetMemo();

  const files = [...touched.pairs].sort(
    (a, b) => byCodeUnit(a.basePath, b.basePath) || byCodeUnit(a.headPath, b.headPath),
  );
  let fileIndex = 0;
  for (const file of files) {
    const index = fileIndex++;
    const baseByName = new Map<string, TestBlock[]>();
    const headByName = new Map<string, TestBlock[]>();
    const candidates: TestBlock[] = [];
    const heads: TestBlock[] = [];
    for (const block of [...file.base].sort(byLine)) {
      if (block.nameDynamic) candidates.push(block);
      else push(baseByName, fullTestName(block), block);
    }
    for (const block of [...file.head].sort(byLine)) {
      if (block.nameDynamic) heads.push(block);
      else push(headByName, fullTestName(block), block);
    }
    for (const [name, baseTests] of baseByName) {
      const headTests = headByName.get(name) ?? [];
      const shared = Math.min(baseTests.length, headTests.length);
      for (let i = 0; i < shared; i++) {
        pairs.push({
          basePath: file.basePath,
          headPath: file.headPath,
          base: baseTests[i] as TestBlock,
          head: headTests[i] as TestBlock,
        });
      }
      for (let i = shared; i < baseTests.length; i++) candidates.push(baseTests[i] as TestBlock);
      for (let i = shared; i < headTests.length; i++) heads.push(headTests[i] as TestBlock);
    }
    for (const [name, headTests] of headByName) {
      if (!baseByName.has(name)) for (const block of headTests) heads.push(block);
    }
    candidates.sort(byLine);
    heads.sort(byLine);

    const entries: NewHead[] = heads.map((block) => ({
      fileIndex: index,
      path: file.headPath,
      block,
      order: 0,
      used: false,
    }));
    for (const entry of entries) fresh.push(entry);

    // Phase 1: the first unused new test of the same file, in head order, with the same body or a similar one.
    const byHash = new Map<string, number[]>();
    for (let at = 0; at < entries.length; at++) push(byHash, (entries[at] as NewHead).block.bodyHash, at);
    const cursor = new Map<string, number>();
    const own = new FreeList(entries);
    const fileLeft: Candidate[] = [];
    for (const block of candidates) {
      let pick = -1;
      const bucket = byHash.get(block.bodyHash);
      if (bucket !== undefined) {
        let at = cursor.get(block.bodyHash) ?? 0;
        while (at < bucket.length && (entries[bucket[at] as number] as NewHead).used) at++;
        cursor.set(block.bodyHash, at);
        if (at < bucket.length) pick = bucket[at] as number;
      }
      const tokens = tokensOf(block);
      const similar = own.walk({
        ...(pick === -1 ? {} : { before: pick }),
        test: (entry) => jaccardAtLeast(tokens, tokensOf(entry.block), FOUR_FIFTHS),
      });
      const chosen = similar ?? (pick === -1 ? null : (entries[pick] as NewHead));
      if (chosen === null) {
        fileLeft.push({ fileIndex: index, path: file.basePath, block });
      } else {
        chosen.used = true;
        pairs.push({ basePath: file.basePath, headPath: file.headPath, base: block, head: chosen.block });
      }
    }

    // R1: a test renamed in its slot of its group.
    const renamed = new Set<TestBlock>();
    for (const answer of renameInPlace(
      fileLeft.map((candidate) => candidate.block),
      entries,
      tokensOf,
    )) {
      answer.fresh.used = true;
      renamed.add(answer.candidate);
      pairs.push({
        basePath: file.basePath,
        headPath: file.headPath,
        base: answer.candidate,
        head: answer.fresh.block,
      });
    }
    // R2: hand-written tests replaced by an `.each` test. The `.each` test counts as used only after all of them.
    const afterRename = fileLeft.filter((candidate) => !renamed.has(candidate.block));
    const cleared = new Set<TestBlock>();
    const clearing: NewHead[] = [];
    for (const answer of eachReplacements(
      afterRename.map((candidate) => candidate.block),
      entries,
    )) {
      cleared.add(answer.candidate);
      clearing.push(answer.fresh);
      replaced.push({
        basePath: file.basePath,
        headPath: file.headPath,
        base: answer.candidate,
        head: answer.fresh.block,
      });
    }
    for (const entry of clearing) entry.used = true;
    for (const candidate of afterRename) if (!cleared.has(candidate.block)) left.push(candidate);
  }
  for (const file of [...touched.added].sort((a, b) => byCodeUnit(a.headPath, b.headPath))) {
    const index = fileIndex++;
    for (const block of [...file.head].sort(byLine)) {
      fresh.push({ fileIndex: index, path: file.headPath, block, order: 0, used: false });
    }
  }

  // Phase 2: the other touched files, in head path then line order.
  fresh.sort((a, b) => byCodeUnit(a.path, b.path) || a.block.line - b.block.line);
  fresh.forEach((entry, at) => {
    entry.order = at;
  });
  const leafEntries = new Map<string, NewHead[]>();
  const hashEntries = new Map<string, NewHead[]>();
  for (const entry of fresh) {
    if (entry.used) continue;
    if (!entry.block.nameDynamic) push(leafEntries, leafName(entry.block), entry);
    push(hashEntries, entry.block.bodyHash, entry);
  }
  const hashLists = new Map<string, FreeList<NewHead>>();
  const hashList = (key: string): FreeList<NewHead> | null => {
    let list = hashLists.get(key);
    if (list === undefined) {
      const found = hashEntries.get(key);
      if (found === undefined) return null;
      list = new FreeList(found);
      hashLists.set(key, list);
    }
    return list;
  };

  const afterNames: Candidate[] = [];
  const moved: MatchedPair[] = [];
  for (const candidate of left) {
    // The same leaf name only names the place to look: the first of the first 256 entries of that leaf's list that is
    // unused, in another file, and holds the candidate's body (a name alone never clears a candidate).
    let byLeaf: NewHead | null = null;
    if (!candidate.block.nameDynamic) {
      const sameLeaf = leafEntries.get(leafName(candidate.block)) ?? [];
      const scan = Math.min(sameLeaf.length, MAX_SIMILARITY_PROBES);
      for (let at = 0; at < scan; at++) {
        const entry = sameLeaf[at] as NewHead;
        if (
          !entry.used &&
          entry.fileIndex !== candidate.fileIndex &&
          holdsBody(candidate.block, entry.block, tokensOf)
        ) {
          byLeaf = entry;
          break;
        }
      }
    }
    // The first unused entry of another file with this body hash: a lookup, not a comparison, so it has no bound.
    const byBody =
      hashList(candidate.block.bodyHash)?.walk({
        own: candidate.fileIndex,
        limit: Number.POSITIVE_INFINITY,
        test: () => true,
      }) ?? null;
    const pick = byLeaf !== null && (byBody === null || byLeaf.order < byBody.order) ? byLeaf : byBody;
    if (pick === null) afterNames.push(candidate);
    else {
      pick.used = true;
      moved.push({ basePath: candidate.path, headPath: pick.path, base: candidate.block, head: pick.block });
    }
  }

  // R3: the other touched files, by body similarity, then by a similar full name with a contained body.
  const afterSimilarity: Candidate[] = [];
  const wordsOf = memoOf((block): ReadonlySet<string> => (block.nameDynamic ? NO_WORDS : fullNameWords(block)));
  const chainsOf = memoOf(assertionChains);
  const all = new FreeList(fresh);
  for (const candidate of afterNames) {
    const bodies = tokensOf(candidate.block);
    let pick = all.walk({
      own: candidate.fileIndex,
      test: (entry) => jaccardAtLeast(bodies, tokensOf(entry.block), FOUR_FIFTHS),
    });
    const words = wordsOf(candidate.block);
    if (pick === null && words.size > 0) {
      const chains = chainsOf(candidate.block);
      pick = all.walk({
        own: candidate.fileIndex,
        test: (entry) =>
          jaccardAtLeast(words, wordsOf(entry.block), HALF) &&
          containsAtLeast(bodies, tokensOf(entry.block), FOUR_FIFTHS) &&
          holdsEveryChain(chains, chainsOf(entry.block)),
      });
    }
    if (pick === null) {
      afterSimilarity.push(candidate);
    } else {
      pick.used = true;
      moved.push({ basePath: candidate.path, headPath: pick.path, base: candidate.block, head: pick.block });
    }
  }

  // The deleted test files whose tests moved: a separate pool, so the rules above never see it.
  const movedFiles: MovedFiles =
    deleted === undefined
      ? { moved: new Set(), compared: new Set(), pairs: [] }
      : matchDeletedFiles(touched, deleted, tokensOf);

  // No rule clears a test by its name alone: what is left is reported, whatever new tests its group gained.
  const unmatched: MatchCandidate[] = afterSimilarity.map((candidate) => ({
    path: candidate.path,
    block: candidate.block,
  }));
  return { unmatched, pairs, moved, replaced, movedFiles };
}
