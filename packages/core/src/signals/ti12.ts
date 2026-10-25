import type { DiffFile } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import type { TestModuleMock } from "../testIndex/types.js";
import { changedSources, resolveMock } from "./mockTargets.js";
import { detailWithName } from "./testName.js";
import type { TouchedTests } from "./testPairs.js";

/** The longest specifier the detail shows, `…` included, in UTF-16 code units. */
const MAX_SPECIFIER = 120;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * The specifier as the detail shows it: every control character a space (the rule `detailWithName` applies to a name),
 * and, when longer than 120 code units, cut so the kept text plus `…` is at most 120, one unit shorter when the cut
 * would split a surrogate pair.
 */
function shownSpecifier(specifier: string): string {
  const clean = detailWithName("", specifier, "");
  if (clean.length <= MAX_SPECIFIER) return clean;
  let end = MAX_SPECIFIER - 1;
  if (end > 0 && isHighSurrogate(clean.charCodeAt(end - 1))) end--;
  return `${clean.slice(0, end)}…`;
}

function detailOf(mock: TestModuleMock, target: string): string {
  return detailWithName(
    `${mock.callee}("${shownSpecifier(mock.specifier ?? "")}") replaces `,
    target,
    ", a source file this change also edits, so the test may not run the code under review.",
  );
}

/** The targets a file's mocks resolve to against `path`, each with the line of its first mock. */
function targetsOf(path: string, mocks: readonly TestModuleMock[], changed: ReadonlyMap<string, string>) {
  const targets = new Map<string, { mock: TestModuleMock }>();
  for (const mock of mocks) {
    const target = resolveMock(path, mock, changed);
    if (target === null) continue;
    const seen = targets.get(target);
    if (seen === undefined || mock.line < seen.mock.line) targets.set(target, { mock });
  }
  return targets;
}

/**
 * TI12, a module under test mocked. A mock new at head (a `vi.mock`, `vi.doMock`, `jest.mock`, `jest.doMock` or Python
 * patch call) whose specifier resolves to a source file the diff adds, modifies or renames is one `warn` finding per
 * test file and target, at the head path and the line of the file's first such mock. A mock is not new when the same
 * file's base mocks resolved to the same target, or when another compared test file had a mock of the target at base
 * and has none at head (the mock moved). The detail is fixed text around the callee, the sanitized specifier (cut to
 * 120 code units) and the target path; no test name or body text reaches it.
 */
export function detectTI12(
  touched: Pick<TouchedTests, "pairs" | "added">,
  diff: readonly DiffFile[],
): TestIntegritySignal[] {
  const changed = changedSources(diff);
  if (changed.size === 0) return [];

  const compared = touched.pairs.map((file) => ({
    file,
    base: targetsOf(file.basePath, file.baseMocks, changed),
    head: targetsOf(file.headPath, file.headMocks, changed),
  }));
  // A target a compared file mocked at base and no longer mocks at head moved: a mock of it elsewhere is not new.
  const moved = new Set<string>();
  for (const { base, head } of compared) {
    for (const target of base.keys()) {
      if (!head.has(target)) moved.add(target);
    }
  }

  const found: TestIntegritySignal[] = [];
  const report = (headPath: string, head: Map<string, { mock: TestModuleMock }>, base: Map<string, unknown>) => {
    for (const [target, { mock }] of head) {
      if (base.has(target) || moved.has(target)) continue;
      found.push({ id: "TI12", severity: "warn", path: headPath, line: mock.line, detail: detailOf(mock, target) });
    }
  };
  for (const { file, base, head } of compared) report(file.headPath, head, base);
  for (const file of touched.added) report(file.headPath, targetsOf(file.headPath, file.headMocks, changed), new Map());
  return found;
}
