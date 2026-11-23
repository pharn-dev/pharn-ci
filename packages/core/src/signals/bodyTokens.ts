/** The tokens of a normalized test body: maximal runs of `[A-Za-z0-9_$]`, and each other non-space character. */
const TOKEN = /[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g;

/**
 * The most not-yet-paired new-at-head tests one rule of the test match compares a removed test with; a match past it is
 * not found, and the removed test is reported (docs/LIMITS.md, section 8).
 */
export const MAX_SIMILARITY_PROBES = 256;

/** The tokens of `body` in order. */
export function bodyTokens(body: string): string[] {
  return body.match(TOKEN) ?? [];
}

/** The distinct tokens of `body`. */
export function bodyTokenSet(body: string): Set<string> {
  return new Set(bodyTokens(body));
}

/** A memo of `bodyTokenSet` per test block, so one match run tokenizes each body once. The sets must not be changed. */
export function tokenSetMemo(): (block: { body: string }) => ReadonlySet<string> {
  const memo = new Map<{ body: string }, ReadonlySet<string>>();
  return (block) => {
    let found = memo.get(block);
    if (found === undefined) {
      found = bodyTokenSet(block.body);
      memo.set(block, found);
    }
    return found;
  };
}

/** A threshold `num/den` between 0 and 1, kept as two integers so every comparison is exact. */
export interface Ratio {
  num: number;
  den: number;
}

/** The ratio phase 1 of the test match has always used: a token-set Jaccard of at least 4/5. */
export const FOUR_FIFTHS: Ratio = { num: 4, den: 5 };
/** The ratios of the other match rules: 1/2 and 3/4. */
export const HALF: Ratio = { num: 1, den: 2 };
export const THREE_QUARTERS: Ratio = { num: 3, den: 4 };

/** The size of the intersection of two sets. */
function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let both = 0;
  for (const token of small) if (large.has(token)) both++;
  return both;
}

/**
 * Whether the Jaccard of `a` and `b` is at least `ratio` (default 4/5), as the integer test
 * `den·|A∩B| ≥ num·|A∪B|`. Two empty sets are similar. The overlap is at most the smaller size and the union at least
 * the larger, so `den·min < num·max` rules the pair out before any element is compared.
 */
export function jaccardAtLeast(a: ReadonlySet<string>, b: ReadonlySet<string>, ratio: Ratio = FOUR_FIFTHS): boolean {
  if (a.size === 0 && b.size === 0) return true;
  const small = Math.min(a.size, b.size);
  const large = Math.max(a.size, b.size);
  if (ratio.den * small < ratio.num * large) return false;
  const both = overlap(a, b);
  return ratio.den * both >= ratio.num * (a.size + b.size - both);
}

/**
 * Whether `fresh` holds at least `ratio` of the distinct elements of `old`, as the integer test
 * `den·|old∩fresh| ≥ num·|old|`. An empty `old` is contained.
 */
export function containsAtLeast(old: ReadonlySet<string>, fresh: ReadonlySet<string>, ratio: Ratio): boolean {
  if (old.size === 0) return true;
  return ratio.den * overlap(old, fresh) >= ratio.num * old.size;
}
