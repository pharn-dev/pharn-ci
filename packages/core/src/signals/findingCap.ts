import type { TestIntegritySignal } from "../report.js";

/** How many findings of one signal id are kept for one file. */
export const MAX_FINDINGS_PER_FILE = 20;

/** The findings left out for one file and signal id. */
export interface OmittedFindings {
  id: string;
  path: string;
  count: number;
}

const RANK = { block: 0, warn: 1, info: 2 } as const;

/**
 * At most `limit` findings per file and per signal id. Within a file and id the findings are taken block first, then
 * warn, then info, each by ascending line (a signal without a line last), so a blocking finding is never the one left
 * out. `kept` has the input's order; `omitted` has one entry per file and id that lost findings, in first-seen order.
 */
export function capFindings(
  signals: readonly TestIntegritySignal[],
  limit: number = MAX_FINDINGS_PER_FILE,
): { kept: TestIntegritySignal[]; omitted: OmittedFindings[] } {
  const groups = new Map<string, TestIntegritySignal[]>();
  for (const signal of signals) {
    const key = `${signal.id}\0${signal.path}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [signal]);
    else group.push(signal);
  }
  const dropped = new Set<TestIntegritySignal>();
  const omitted: OmittedFindings[] = [];
  for (const group of groups.values()) {
    if (group.length <= limit) continue;
    const ranked = group
      .map((signal, index) => ({ signal, index }))
      .sort(
        (a, b) =>
          RANK[a.signal.severity] - RANK[b.signal.severity] ||
          (a.signal.line ?? Number.POSITIVE_INFINITY) - (b.signal.line ?? Number.POSITIVE_INFINITY) ||
          a.index - b.index,
      );
    for (const { signal } of ranked.slice(limit)) dropped.add(signal);
    const first = group[0] as TestIntegritySignal;
    omitted.push({ id: first.id, path: first.path, count: group.length - limit });
  }
  return { kept: signals.filter((signal) => !dropped.has(signal)), omitted };
}
