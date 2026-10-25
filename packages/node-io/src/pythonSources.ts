import {
  type PythonIndexRun,
  type PythonSourceFile,
  type PythonTestIndex,
  pythonTestIndexFromRun,
  pythonTestSourceFiles,
  type TestSources,
} from "@pharn-ci/core";
import { indexPythonTests } from "./pythonIndex.js";

/**
 * Indexes the `.py` test files of the test sources (base files, then head files) with one Python run, and gives
 * `check()` the plain-data result. Undefined, and `index` never called, when the sources hold no `.py` test file. A
 * throw from `index` is `{ available: false, reason: "python-failed" }`. The run's `detail` is dropped; nothing is
 * logged here.
 */
export async function indexPythonTestSources(
  sources: TestSources,
  index: (files: readonly PythonSourceFile[]) => Promise<PythonIndexRun> = (files) => indexPythonTests(files),
): Promise<PythonTestIndex | undefined> {
  const files = pythonTestSourceFiles(sources);
  if (files.length === 0) return undefined;
  let run: PythonIndexRun;
  try {
    run = await index(files);
  } catch {
    return { available: false, reason: "python-failed" };
  }
  return pythonTestIndexFromRun(sources, run);
}
