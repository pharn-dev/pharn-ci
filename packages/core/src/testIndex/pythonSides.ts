import { isTestFile } from "../testFiles.js";
import type { TestSourceSide, TestSources } from "../testSources.js";
import type { PythonIndexFile, PythonIndexRun, PythonIndexUnavailableReason, PythonSourceFile } from "./pythonTypes.js";

/**
 * The Python test index of the sources, as `check()` takes it: plain data, one entry per `.py` test file of each side,
 * or why there is none. Unlike a Python run (`PythonIndexRun`) it carries no `detail`, so no interpreter output can
 * reach a report.
 */
export type PythonTestIndex =
  | { available: false; reason: PythonIndexUnavailableReason }
  | { available: true; base: PythonIndexFile[]; head: PythonIndexFile[] };

function sideFiles(side: TestSourceSide): PythonSourceFile[] {
  if ("unavailable" in side) return [];
  return side.files.filter((file) => file.path.endsWith(".py") && isTestFile(file.path));
}

/**
 * The `.py` test files to hand the Python index: the kept `.py` test files of an available base side, then those of an
 * available head side, each in the sources' order. Empty when there is none (nothing to run).
 */
export function pythonTestSourceFiles(sources: TestSources): PythonSourceFile[] {
  return [...sideFiles(sources.base), ...sideFiles(sources.head)];
}

/**
 * The index `check()` takes from a Python run over `pythonTestSourceFiles(sources)`: the run's files split by the
 * number of base files, and the run's `detail` dropped. A run whose file count differs from the number sent is
 * `bad-output`.
 */
export function pythonTestIndexFromRun(sources: TestSources, run: PythonIndexRun): PythonTestIndex {
  if (!run.available) return { available: false, reason: run.reason };
  const baseCount = sideFiles(sources.base).length;
  const total = baseCount + sideFiles(sources.head).length;
  if (run.files.length !== total) return { available: false, reason: "bad-output" };
  return { available: true, base: run.files.slice(0, baseCount), head: run.files.slice(baseCount) };
}
