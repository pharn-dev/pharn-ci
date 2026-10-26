/** The tokens of a normalized test body: maximal runs of `[A-Za-z0-9_$]`, and each other non-space character. */
const TOKEN = /[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g;

/** The most posting entries one similarity probe looks at; past it the candidate is matched by body hash only. */
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

/** ceil(n · num/den) in integers. */
export function ceilRatio(n: number, ratio: Ratio): number {
  return Math.floor((ratio.num * n + ratio.den - 1) / ratio.den);
}

/** The size of the intersection of two sets. */
function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let both = 0;
  for (const token of small) if (large.has(token)) both++;
  return both;
}

/**
 * Whether the Jaccard of `a` and `b` is at least `ratio` (default 4/5), as the integer test
 * `den·|A∩B| ≥ num·|A∪B|`. Two empty sets are similar.
 */
export function jaccardAtLeast(a: ReadonlySet<string>, b: ReadonlySet<string>, ratio: Ratio = FOUR_FIFTHS): boolean {
  if (a.size === 0 && b.size === 0) return true;
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

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A minimal binary min-heap of posting cursors, ordered by the head index each one points at. */
class CursorHeap {
  private readonly list: number[] = [];
  private readonly at: number[] = [];
  private readonly key: number[] = [];

  get size(): number {
    return this.key.length;
  }

  push(list: number, at: number, key: number): void {
    this.list.push(list);
    this.at.push(at);
    this.key.push(key);
    let i = this.key.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.key[parent] as number) <= (this.key[i] as number)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** The smallest cursor, removed. */
  pop(): { list: number; at: number; key: number } {
    const top = { list: this.list[0] as number, at: this.at[0] as number, key: this.key[0] as number };
    const last = this.key.length - 1;
    this.swap(0, last);
    this.list.pop();
    this.at.pop();
    this.key.pop();
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < this.key.length && (this.key[left] as number) < (this.key[smallest] as number)) smallest = left;
      if (right < this.key.length && (this.key[right] as number) < (this.key[smallest] as number)) smallest = right;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
    return top;
  }

  private swap(a: number, b: number): void {
    for (const column of [this.list, this.at, this.key]) {
      const held = column[a] as number;
      column[a] = column[b] as number;
      column[b] = held;
    }
  }
}

/**
 * Finds, for a set of strings (body tokens or name words), the first head set (in head order) that is not skipped and
 * has a Jaccard of at least `ratio` (default 4/5) with it, without comparing it with every head set. An AllPairs
 * prefix filter: elements are ordered by how many of the candidate and head sets hold them (rarest first, then by code
 * unit), a set of n elements is indexed and probed by its first `n − ceil(ratio·n) + 1` elements, and two sets this
 * similar always share an element there. A probe merges the posting lists of the candidate's prefix in head order,
 * drops entries whose size cannot reach the ratio and verifies the rest, so it stops at the first match. An optional
 * `accept` predicate must also hold for the match. It looks at no more than `MAX_SIMILARITY_PROBES` posting entries,
 * skipped and rejected ones included.
 */
export class SimilarityIndex {
  private readonly frequency = new Map<string, number>();
  private readonly postings = new Map<string, number[]>();
  private readonly empty: number[] = [];

  constructor(
    private readonly heads: readonly ReadonlySet<string>[],
    candidates: readonly ReadonlySet<string>[],
    private readonly ratio: Ratio = FOUR_FIFTHS,
  ) {
    for (const set of heads) this.count(set);
    for (const set of candidates) this.count(set);
    heads.forEach((set, index) => {
      if (set.size === 0) {
        this.empty.push(index);
        return;
      }
      for (const token of this.prefix(set)) {
        const list = this.postings.get(token);
        if (list === undefined) this.postings.set(token, [index]);
        else list.push(index);
      }
    });
  }

  private count(set: ReadonlySet<string>): void {
    for (const token of set) this.frequency.set(token, (this.frequency.get(token) ?? 0) + 1);
  }

  private prefix(set: ReadonlySet<string>): string[] {
    const frequency = this.frequency;
    const ordered = [...set].sort((a, b) => (frequency.get(a) ?? 0) - (frequency.get(b) ?? 0) || byCodeUnit(a, b));
    return ordered.slice(0, set.size - ceilRatio(set.size, this.ratio) + 1);
  }

  /**
   * The index of the first head set similar to `candidate`, below `below`, not skipped and accepted, or -1 when there
   * is none. `bounded` is true when the probe stopped at the bound without finding one, so a similar head set may exist.
   */
  find(
    candidate: ReadonlySet<string>,
    isSkipped: (index: number) => boolean,
    below = Number.POSITIVE_INFINITY,
    accept: (index: number) => boolean = () => true,
  ): { index: number; bounded: boolean } {
    if (candidate.size === 0) {
      for (const index of this.empty) {
        if (index >= below) break;
        if (!isSkipped(index) && accept(index)) return { index, bounded: false };
      }
      return { index: -1, bounded: false };
    }
    const lists: number[][] = [];
    const heap = new CursorHeap();
    for (const token of this.prefix(candidate)) {
      const list = this.postings.get(token);
      if (list === undefined) continue;
      lists.push(list);
      heap.push(lists.length - 1, 0, list[0] as number);
    }
    const least = ceilRatio(candidate.size, this.ratio);
    // |B| ≤ |A| / ratio, in integers.
    const most = Math.floor((this.ratio.den * candidate.size) / this.ratio.num);
    let probes = 0;
    let previous = -1;
    while (heap.size > 0) {
      const { list, at, key } = heap.pop();
      const entries = lists[list] as number[];
      if (at + 1 < entries.length) heap.push(list, at + 1, entries[at + 1] as number);
      if (key >= below) break;
      if (key === previous) continue;
      previous = key;
      if (++probes > MAX_SIMILARITY_PROBES) return { index: -1, bounded: true };
      if (isSkipped(key)) continue;
      const head = this.heads[key] as ReadonlySet<string>;
      if (head.size < least || head.size > most) continue;
      if (jaccardAtLeast(candidate, head, this.ratio) && accept(key)) return { index: key, bounded: false };
    }
    return { index: -1, bounded: false };
  }
}
