import type { DiffFile } from "../diff/unified.js";
import { compileGlob } from "../glob.js";
import { P14_GENERATED_FILES } from "../policy/rules/p14.js";
import { isTestFile } from "../testFiles.js";
import type { TestBlock } from "../testIndex/types.js";
import { isTestConfigFile } from "../testSources.js";
import { byCodeUnit } from "../text.js";
import { resolveRelativeModule } from "./mockTargets.js";
import { languageOf, type TouchedTests } from "./testPairs.js";

/**
 * The files the tests-exercise check never asks a test for, besides P14's generated files (lockfiles, snapshots,
 * `*.generated.*`): committed build output and vendored code, as globs in the syntax of `coverage.exclude`.
 */
export const EXERCISE_SKIPPED_FILES: readonly string[] = Object.freeze([
  ...P14_GENERATED_FILES,
  "**/dist/**",
  "**/node_modules/**",
  "**/vendor/**",
  "**/*.min.*",
]);

/** What the tests-exercise check found: how many changed source files it checked, and those no changed test imports. */
export interface ExerciseResult {
  checked: number;
  /** Sorted in code-unit order; every one of them, uncapped. */
  notExercised: string[];
}

const DECLARATION_SUFFIXES: readonly string[] = [".d.ts", ".d.mts", ".d.cts"];

/** A tool's config file by name: a dotfile, a basename with `.config.` in it, or a test-runner config file. */
function isConfigFile(path: string): boolean {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return basename.startsWith(".") || basename.includes(".config.") || isTestConfigFile(path);
}

/**
 * The changed source files the check asks a test for, sorted in code-unit order: an added, modified or renamed entry
 * with at least one added line (not binary) whose path has a JavaScript or TypeScript extension and is not a test file,
 * a declaration file (`.d.ts`, `.d.mts`, `.d.cts`), a config file (a dotfile, a basename with `.config.` in it, or a
 * test-runner config), a generated or build-output file (`EXERCISE_SKIPPED_FILES`) or a path `excluded` matches.
 */
export function exerciseCandidates(diff: readonly DiffFile[], excluded: (path: string) => boolean): string[] {
  const skipped = EXERCISE_SKIPPED_FILES.map((glob) => compileGlob(glob));
  const paths = new Set<string>();
  for (const file of diff) {
    if (file.status === "deleted" || file.binary === true || file.addedLines.length === 0) continue;
    const path = file.path;
    if (languageOf(path) === null || languageOf(path) === "py") continue;
    if (isTestFile(path) || DECLARATION_SUFFIXES.some((suffix) => path.endsWith(suffix)) || isConfigFile(path)) {
      continue;
    }
    if (skipped.some((matches) => matches(path)) || excluded(path)) continue;
    paths.add(path);
  }
  return [...paths].sort(byCodeUnit);
}

/** The assertions of a file's tests, summed. */
function assertionsOf(tests: readonly TestBlock[]): number {
  let total = 0;
  for (const test of tests) total += test.assertionCount;
  return total;
}

/**
 * The tests-exercise check (A8 step 1). A changed source file (`exerciseCandidates`) counts as exercised when a
 * JavaScript or TypeScript test file the change adds or modifies imports it directly and keeps or raises its assertion
 * count: an added test file with at least one assertion at head, or a compared test file (modified, or renamed between
 * two test paths) whose diff adds or removes a line and whose head has at least one assertion and no fewer than its
 * base, counting the assertions of its tests. The imports are the head file's module specifiers (`headImports`) that
 * start `./` or `../`, resolved from the test file's head path with `resolveRelativeModule` against the tracked files
 * and the diff's new paths. A test file that could not be indexed, and a Python test file, give no evidence. Null when
 * there is no candidate.
 */
export function detectUnexercisedChanges(
  diff: readonly DiffFile[],
  touched: Pick<TouchedTests, "pairs" | "added">,
  repoFiles: readonly string[],
  excluded: (path: string) => boolean,
): ExerciseResult | null {
  const candidates = exerciseCandidates(diff, excluded);
  if (candidates.length === 0) return null;
  const known = new Set(repoFiles);
  const edited = new Set<string>();
  for (const file of diff) {
    if (file.status === "deleted") continue;
    known.add(file.path);
    if (file.addedLines.length > 0 || (file.removedCount ?? 0) > 0) edited.add(file.path);
  }
  const lookup = (candidate: string) => (known.has(candidate) ? candidate : undefined);

  const evidence: Array<{ path: string; imports: readonly string[] }> = [];
  for (const file of touched.added) {
    if (file.headImports !== undefined && assertionsOf(file.head) > 0) {
      evidence.push({ path: file.headPath, imports: file.headImports });
    }
  }
  for (const file of touched.pairs) {
    if (file.headImports === undefined || !edited.has(file.headPath)) continue;
    const head = assertionsOf(file.head);
    if (head > 0 && head >= assertionsOf(file.base)) evidence.push({ path: file.headPath, imports: file.headImports });
  }

  const wanted = new Set(candidates);
  const exercised = new Set<string>();
  for (const { path, imports } of evidence) {
    for (const specifier of imports) {
      const target = resolveRelativeModule(path, specifier, lookup);
      if (target !== null && wanted.has(target)) exercised.add(target);
    }
  }
  return { checked: candidates.length, notExercised: candidates.filter((path) => !exercised.has(path)) };
}
