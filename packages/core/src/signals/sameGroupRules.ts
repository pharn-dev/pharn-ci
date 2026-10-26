import type { TestBlock } from "../testIndex/types.js";
import { containsAtLeast, FOUR_FIFTHS, HALF, jaccardAtLeast, THREE_QUARTERS } from "./bodyTokens.js";
import { groupKey } from "./nameWords.js";
import { assertionChains, holdsEveryChain, sharesAny, testSubjects } from "./testSubjects.js";

/** A test that is new at head, as the same-group rules see it. */
export interface FreshTest {
  block: TestBlock;
  /** Already paired or cleared by an earlier rule. */
  used: boolean;
}

/** A candidate and the new-at-head test that answers it. */
export interface Answer<F extends FreshTest> {
  candidate: TestBlock;
  fresh: F;
}

/** The distinct body tokens of a test, memoized by the caller. */
export type TokensOf = (block: TestBlock) => ReadonlySet<string>;

/**
 * The body evidence a test needs before another test counts as holding it: a body-token Jaccard of at least 4/5, or a
 * body that holds at least 4/5 of the old body's distinct tokens and every assertion chain the old one held. A name
 * never counts. The chains are computed only when the containment passes.
 */
export function holdsBody(before: TestBlock, after: TestBlock, tokensOf: TokensOf): boolean {
  const old = tokensOf(before);
  const fresh = tokensOf(after);
  return (
    jaccardAtLeast(old, fresh, FOUR_FIFTHS) ||
    (containsAtLeast(old, fresh, FOUR_FIFTHS) && holdsEveryChain(assertionChains(before), assertionChains(after)))
  );
}

/** The most `.each` tests one candidate is compared with. */
export const MAX_EACH_SCAN = 256;

function groupItems<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [item]);
    else list.push(item);
  }
  return groups;
}

/**
 * R1, rename in place. Per group (the exact names of the enclosing blocks): when it has as many candidates left as
 * unused new-at-head tests, the i-th candidate and the i-th new test, both in line order, answer each other when the
 * body-token Jaccard is at least 1/2 and the new body holds at least 3/4 of the old body's distinct tokens. At most one
 * comparison per candidate. Both lists must be in line order.
 */
export function renameInPlace<F extends FreshTest>(
  candidates: readonly TestBlock[],
  fresh: readonly F[],
  tokensOf: TokensOf,
): Array<Answer<F>> {
  const unusedByGroup = groupItems(
    fresh.filter((entry) => !entry.used),
    (entry) => groupKey(entry.block),
  );
  const answers: Array<Answer<F>> = [];
  for (const [key, group] of groupItems(candidates, groupKey)) {
    const unused = unusedByGroup.get(key);
    if (unused === undefined || unused.length !== group.length) continue;
    group.forEach((candidate, at) => {
      const entry = unused[at] as F;
      const before = tokensOf(candidate);
      const after = tokensOf(entry.block);
      if (jaccardAtLeast(before, after, HALF) && containsAtLeast(before, after, THREE_QUARTERS)) {
        answers.push({ candidate, fresh: entry });
      }
    });
  }
  return answers;
}

/**
 * R2, `.each` replacement. Per group: a candidate with at least one assertion is cleared by the first, among the first
 * 256 not-yet-paired new-at-head `.each` tests of the group (line order), that shares a subject with it and holds every
 * assertion chain it held. One `.each` test may clear several candidates. Both lists must be in line order.
 */
export function eachReplacements<F extends FreshTest>(
  candidates: readonly TestBlock[],
  fresh: readonly F[],
): Array<Answer<F>> {
  const eachByGroup = groupItems(
    fresh.filter((entry) => !entry.used && entry.block.modifiers.includes("each")),
    (entry) => groupKey(entry.block),
  );
  if (eachByGroup.size === 0) return [];
  // The first 256 `.each` tests of a group, each kept only if no earlier one has the same subjects and chains: the
  // first test that matches a candidate is then the first of the first shape that matches it.
  const shapesByGroup = new Map<string, Array<Shape<F>>>();
  const shapesOf = (key: string, group: readonly F[]): Array<Shape<F>> => {
    let shapes = shapesByGroup.get(key);
    if (shapes === undefined) {
      shapes = [];
      const seen = new Set<string>();
      for (const entry of group.slice(0, MAX_EACH_SCAN)) {
        const subjects = testSubjects(entry.block.body);
        const chains = assertionChains(entry.block);
        const shape = JSON.stringify([[...subjects].sort(), [...chains].sort()]);
        if (seen.has(shape)) continue;
        seen.add(shape);
        shapes.push({ entry, subjects, chains });
      }
      shapesByGroup.set(key, shapes);
    }
    return shapes;
  };
  const answers: Array<Answer<F>> = [];
  for (const candidate of candidates) {
    if (candidate.assertionCount < 1) continue;
    const key = groupKey(candidate);
    const group = eachByGroup.get(key);
    if (group === undefined) continue;
    const wanted = testSubjects(candidate.body);
    if (wanted.size === 0) continue;
    const held = assertionChains(candidate);
    const found = shapesOf(key, group).find(
      (shape) => sharesAny(wanted, shape.subjects) && holdsEveryChain(held, shape.chains),
    );
    if (found !== undefined) answers.push({ candidate, fresh: found.entry });
  }
  return answers;
}

/** The subjects and assertion chains of one `.each` test, with the test. */
interface Shape<F> {
  entry: F;
  subjects: ReadonlySet<string>;
  chains: ReadonlySet<string>;
}
