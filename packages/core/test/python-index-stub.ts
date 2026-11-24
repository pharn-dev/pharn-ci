import { isTestFile } from "../src/testFiles.js";
import type { PythonTestIndex } from "../src/testIndex/pythonSides.js";
import type { PythonIndexFile } from "../src/testIndex/pythonTypes.js";
import type { TestSourceSide, TestSources } from "../src/testSources.js";

/** The `[local, target]` import bindings the Python index reports for a file, by the file's repo-relative path. */
export type AliasPairsByPath = Readonly<Record<string, readonly (readonly [local: string, target: string])[]>>;

function entriesOf(side: TestSourceSide, aliases: AliasPairsByPath): PythonIndexFile[] {
  if (!("files" in side)) return [];
  return side.files
    .filter((file) => file.path.endsWith(".py") && isTestFile(file.path))
    .map((file): PythonIndexFile => {
      const pairs = aliases[file.path] ?? [];
      return {
        path: file.path,
        result: { parsed: true, syntaxErrors: 0, tests: [], mocks: [] },
        ...(pairs.length === 0 ? {} : { aliases: pairs.map(([local, target]): [string, string] => [local, target]) }),
      };
    });
}

/**
 * A Python test index for tests that hand `check()` Python text without running an interpreter: one parsed entry with no
 * tests per `.py` test file each available side of `sources` holds, carrying the alias pairs given for its path (none
 * given: no `aliases` key, as the real index writes none for a file without a renamed import). `head` defaults to
 * `base`, so one table serves both sides. What the real interpreter reports for the same imports is pinned by
 * packages/node-io/test/ac-core356-index-aliases.test.ts.
 */
export function stubPythonIndex(
  sources: TestSources,
  base: AliasPairsByPath = {},
  head: AliasPairsByPath = base,
): PythonTestIndex {
  return { available: true, base: entriesOf(sources.base, base), head: entriesOf(sources.head, head) };
}
