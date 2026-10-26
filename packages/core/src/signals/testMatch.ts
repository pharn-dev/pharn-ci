import type { TestBlock } from "../testIndex/types.js";
import { containsAtLeast, FOUR_FIFTHS, HALF, SimilarityIndex, tokenSetMemo } from "./bodyTokens.js";
import { fullNameWords } from "./nameWords.js";
import { eachReplacements, renameInPlace } from "./sameGroupRules.js";
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
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
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

const leafName = (block: TestBlock): string => block.path[block.path.length - 1] ?? "";

/**
 * A list of new-at-head tests in head order that can say which unused entry of another file comes first, in near
 * constant time: `next` skips used entries, and `blockEnd` skips the entries of the candidate's own file (head paths
 * are distinct, so a file's entries are adjacent).
 */
class OtherFileList {
  private readonly next: Int32Array;
  private readonly blockEnd: Int32Array;

  constructor(private readonly entries: readonly NewHead[]) {
    const n = entries.length;
    this.next = new Int32Array(n + 1);
    this.blockEnd = new Int32Array(n + 1);
    for (let i = 0; i <= n; i++) this.next[i] = i;
    this.blockEnd[n] = n;
    for (let i = n - 1; i >= 0; i--) {
      const following = entries[i + 1];
      this.blockEnd[i] =
        following !== undefined && following.fileIndex === (entries[i] as NewHead).fileIndex
          ? (this.blockEnd[i + 1] as number)
          : i + 1;
    }
  }

  private find(from: number): number {
    const n = this.entries.length;
    let root = from;
    while (root < n && ((this.next[root] as number) !== root || (this.entries[root] as NewHead).used)) {
      if ((this.next[root] as number) === root) this.next[root] = root + 1;
      root = this.next[root] as number;
    }
    let step = from;
    while (step < root) {
      const following = this.next[step] as number;
      this.next[step] = root;
      step = following;
    }
    return root;
  }

  /** The first unused entry that is not in file `fileIndex`, or null. */
  firstOutside(fileIndex: number): NewHead | null {
    const n = this.entries.length;
    let at = this.find(0);
    while (at < n) {
      const entry = this.entries[at] as NewHead;
      if (entry.fileIndex !== fileIndex) return entry;
      at = this.find(this.blockEnd[at] as number);
    }
    return null;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/**
 * Matches the tests of the touched test files between base and head. Only tests (kind `test`) count.
 *
 * Per compared file the static names are compared as multisets, pairing base and head instances in line order; the
 * excess base instances (highest lines) are candidates and the excess head instances are new at head. A test whose name
 * is computed never takes part in name matching: on base it is always a candidate, on head always new. Every test of an
 * added file is new at head.
 *
 * The rules run in this order. Every threshold is an integer comparison; every similarity probe looks at no more than
 * 256 posting entries.
 *
 * 1. Phase 1, per file in base-path order, each candidate in base-line order takes the first unused new-at-head test of
 *    its own file with an equal body hash or a token-set Jaccard of at least 4/5 (a pair).
 * 2. R1, rename in place, per file and group (the exact names of the enclosing blocks): when a group has as many
 *    candidates left as unused new-at-head tests, the i-th of each, in line order, are a pair when the body-token
 *    Jaccard is at least 1/2 and the new body holds at least 3/4 of the old body's distinct tokens.
 * 3. R2, `.each` replacement, per file and group: a candidate with an assertion is cleared by the first of the first
 *    256 not-yet-paired new-at-head `.each` tests that shares a subject with it and holds every assertion chain it
 *    held. That is listed in `replaced`, not `pairs`; the `.each` test counts as used from then on.
 * 4. Phase 2, over what is left, each candidate takes the first unused new-at-head test of another touched file (head
 *    path, then line) with the same leaf name or the same body hash; that only clears the candidate (`moved`).
 * 5. R3, cross-file similarity, over what is left: the first unused new-at-head test of another touched file with a
 *    body-token Jaccard of at least 4/5; else the first whose full-name words have a Jaccard of at least 1/2, whose
 *    body holds at least 4/5 of the candidate's distinct body tokens and every assertion chain the candidate held.
 *    That also only clears the candidate (`moved`).
 *
 * Every rule needs the test's code to survive: a name alone (the part a change controls most easily) never clears or
 * softens a candidate here.
 *
 * A new-at-head test answers at most one candidate, except an `.each` test, which may clear several.
 */
export function matchTests(touched: Pick<TouchedTests, "pairs" | "added">): TestMatch {
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
    const similar =
      candidates.length > 0 && entries.length > 0
        ? new SimilarityIndex(
            entries.map((entry) => tokensOf(entry.block)),
            candidates.map(tokensOf),
          )
        : null;
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
      if (similar !== null) {
        const found = similar.find(
          tokensOf(block),
          (at) => (entries[at] as NewHead).used,
          pick === -1 ? Number.POSITIVE_INFINITY : pick,
        );
        if (found.index !== -1) pick = found.index;
      }
      if (pick === -1) {
        fileLeft.push({ fileIndex: index, path: file.basePath, block });
      } else {
        const entry = entries[pick] as NewHead;
        entry.used = true;
        pairs.push({ basePath: file.basePath, headPath: file.headPath, base: block, head: entry.block });
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
  const leafLists = new Map<string, OtherFileList>();
  const hashLists = new Map<string, OtherFileList>();
  const listFor = (lists: Map<string, OtherFileList>, entries: Map<string, NewHead[]>, key: string) => {
    let list = lists.get(key);
    if (list === undefined) {
      const found = entries.get(key);
      if (found === undefined) return null;
      list = new OtherFileList(found);
      lists.set(key, list);
    }
    return list;
  };

  const afterNames: Candidate[] = [];
  const moved: MatchedPair[] = [];
  for (const candidate of left) {
    const byLeaf = candidate.block.nameDynamic
      ? null
      : (listFor(leafLists, leafEntries, leafName(candidate.block))?.firstOutside(candidate.fileIndex) ?? null);
    const byBody = listFor(hashLists, hashEntries, candidate.block.bodyHash)?.firstOutside(candidate.fileIndex) ?? null;
    const pick = byLeaf !== null && (byBody === null || byLeaf.order < byBody.order) ? byLeaf : byBody;
    if (pick === null) afterNames.push(candidate);
    else {
      pick.used = true;
      moved.push({ basePath: candidate.path, headPath: pick.path, base: candidate.block, head: pick.block });
    }
  }

  // R3: the other touched files, by body similarity, then by a similar full name with a contained body.
  const afterSimilarity: Candidate[] = [];
  const pool = fresh.filter((entry) => !entry.used);
  if (afterNames.length > 0 && pool.length > 0) {
    const poolBodies = pool.map((entry) => tokensOf(entry.block));
    const poolNames = pool.map((entry) => (entry.block.nameDynamic ? new Set<string>() : fullNameWords(entry.block)));
    const candidateNames = afterNames.map((candidate) =>
      candidate.block.nameDynamic ? new Set<string>() : fullNameWords(candidate.block),
    );
    const candidateBodies = afterNames.map((candidate) => tokensOf(candidate.block));
    const bodyIndex = new SimilarityIndex(poolBodies, candidateBodies, FOUR_FIFTHS);
    const nameIndex = new SimilarityIndex(poolNames, candidateNames, HALF);
    afterNames.forEach((candidate, at) => {
      const skipped = (index: number) => {
        const entry = pool[index] as NewHead;
        return entry.used || entry.fileIndex === candidate.fileIndex;
      };
      const bodies = candidateBodies[at] as ReadonlySet<string>;
      let found = bodyIndex.find(bodies, skipped).index;
      const words = candidateNames[at] as ReadonlySet<string>;
      if (found === -1 && words.size > 0) {
        const chains = assertionChains(candidate.block);
        found = nameIndex.find(
          words,
          skipped,
          Number.POSITIVE_INFINITY,
          (index) =>
            containsAtLeast(bodies, poolBodies[index] as ReadonlySet<string>, FOUR_FIFTHS) &&
            holdsEveryChain(chains, assertionChains((pool[index] as NewHead).block)),
        ).index;
      }
      if (found === -1) {
        afterSimilarity.push(candidate);
      } else {
        const pick = pool[found] as NewHead;
        pick.used = true;
        moved.push({ basePath: candidate.path, headPath: pick.path, base: candidate.block, head: pick.block });
      }
    });
  } else {
    afterSimilarity.push(...afterNames);
  }

  // No rule clears a test by its name alone: what is left is reported, whatever new tests its group gained.
  const unmatched: MatchCandidate[] = afterSimilarity.map((candidate) => ({
    path: candidate.path,
    block: candidate.block,
  }));
  return { unmatched, pairs, moved, replaced };
}
