import type { ReportTestChange, ReportTestChanges, ReportTestChangesFile } from "../report.js";
import type { TestBlock } from "../testIndex/types.js";
import type { TestMatch } from "./testMatch.js";
import { fullTestName, summaryTestName } from "./testName.js";
import { languageOf, type TouchedTests } from "./testPairs.js";

/** The most test entries the summary lists across its four lists; the totals and the file rows count every test. */
export const MAX_TEST_CHANGE_ENTRIES = 200;

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byEntry = (a: ReportTestChange, b: ReportTestChange) => byCodeUnit(a.path, b.path) || a.line - b.line;

type Kind = "added" | "removed" | "modified" | "renamed";
/** The order the 200-entry cap is filled in. */
const KINDS: readonly Kind[] = ["removed", "modified", "renamed", "added"];

const entryOf = (path: string, block: TestBlock): ReportTestChange => ({
  path,
  name: summaryTestName(fullTestName(block)),
  line: block.line,
});

/**
 * The tests-changed summary of the touched test files, from the base-and-head match: each test added (new at head and
 * matched to no base test), removed (TI02's candidates: a base test nothing at head stands for), modified (the same
 * name in the same file, with another body or other modifiers) or renamed (matched to a test of another name, or in
 * another file). An `.each` test that replaced hand-written tests is listed once, under renamed. Removed tests sit at
 * their base path and base line; the others at their head path and head line. Null when no test changed, so a report
 * gains the field only when it carries something.
 */
export function summarizeTestChanges(
  touched: Pick<TouchedTests, "pairs" | "added">,
  match: Pick<TestMatch, "unmatched" | "pairs" | "moved"> & Partial<Pick<TestMatch, "replaced">>,
): ReportTestChanges | null {
  const lists: Record<Kind, ReportTestChange[]> = { added: [], removed: [], modified: [], renamed: [] };
  const matchedHeads = new Set<TestBlock>();
  for (const pair of match.replaced ?? []) {
    if (matchedHeads.has(pair.head)) continue;
    matchedHeads.add(pair.head);
    lists.renamed.push(entryOf(pair.headPath, pair.head));
  }
  for (const pair of [...match.pairs, ...match.moved]) {
    matchedHeads.add(pair.head);
    const sameName = fullTestName(pair.base) === fullTestName(pair.head);
    if (!sameName || pair.basePath !== pair.headPath) {
      lists.renamed.push(entryOf(pair.headPath, pair.head));
    } else if (
      pair.base.bodyHash !== pair.head.bodyHash ||
      pair.base.modifiers.join(",") !== pair.head.modifiers.join(",")
    ) {
      lists.modified.push(entryOf(pair.headPath, pair.head));
    }
  }
  for (const candidate of match.unmatched) lists.removed.push(entryOf(candidate.path, candidate.block));
  for (const file of [...touched.pairs, ...touched.added]) {
    for (const block of file.head) if (!matchedHeads.has(block)) lists.added.push(entryOf(file.headPath, block));
  }
  const total = KINDS.reduce((sum, kind) => sum + lists[kind].length, 0);
  if (total === 0) return null;

  const rows = new Map<string, ReportTestChangesFile>();
  for (const kind of KINDS) {
    lists[kind].sort(byEntry);
    for (const entry of lists[kind]) {
      let row = rows.get(entry.path);
      if (row === undefined) {
        row = {
          path: entry.path,
          language: languageOf(entry.path) ?? "ts",
          added: 0,
          removed: 0,
          modified: 0,
          renamed: 0,
        };
        rows.set(entry.path, row);
      }
      row[kind]++;
    }
  }

  let room = MAX_TEST_CHANGE_ENTRIES;
  const kept: Record<Kind, ReportTestChange[]> = { added: [], removed: [], modified: [], renamed: [] };
  for (const kind of KINDS) {
    kept[kind] = lists[kind].slice(0, room);
    room -= kept[kind].length;
  }
  const truncated = total - KINDS.reduce((sum, kind) => sum + kept[kind].length, 0);
  return {
    totals: {
      added: lists.added.length,
      removed: lists.removed.length,
      modified: lists.modified.length,
      renamed: lists.renamed.length,
    },
    files: [...rows.values()].sort((a, b) => byCodeUnit(a.path, b.path)),
    added: kept.added,
    removed: kept.removed,
    modified: kept.modified,
    renamed: kept.renamed,
    ...(truncated > 0 ? { truncated } : {}),
  };
}
