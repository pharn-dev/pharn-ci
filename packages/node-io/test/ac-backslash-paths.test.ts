import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "../../core/src/index.js";

// CORE-101: the CLI and the Action read coverage through readCoverageFiles, which parses each file as it is read. A
// path with a backslash keeps its literal key there, so check() can give the record to the tracked file it names.

const fixture = (path: string) => readFileSync(new URL(`../../../fixtures/${path}`, import.meta.url), "utf8");

const REPO_ROOT = "/home/runner/work/demo/demo";

function deps(files: Record<string, string>) {
  return {
    listDir: async () => null,
    readFile: async (path: string) => files[path] ?? null,
    resolvePath: (...segments: string[]) => posix.resolve(...segments),
  };
}

describe("CORE-101: readCoverageFiles keeps a backslash that names a tracked file", () => {
  for (const file of ["coverage.info", "coverage.xml"]) {
    it(`gives each record of ${file} to the file its literal path names, and a Windows path to its separator form`, async () => {
      const { readCoverageFiles } = await import("../src/index.js");
      const read = (dir: string) =>
        readCoverageFiles(deps({ [`/ws/${file}`]: fixture(`backslash-paths/${dir}/${file}`) }), {
          entries: file,
          label: "coverage-file",
          baseDir: "/ws",
          format: "auto",
          repoRoot: REPO_ROOT,
          name: (entry) => entry,
          log: () => {},
        });
      const run = async (dir: string) =>
        check({
          version: "0.1.0",
          coverage: { files: await read(dir), format: "auto" },
          diff: { text: fixture(`backslash-paths/${dir}/pr.diff`) },
          repoRoot: REPO_ROOT,
          threshold: 80,
          repoFiles: fixture(`backslash-paths/${dir}/files.txt`).trim().split("\n"),
        });

      const both = await run("both");
      expect(both.diffCoverage?.files.map((f) => [f.path, f.coveredLines, f.coverableLines])).toEqual([
        ["src/a/b.js", 2, 2],
        ["src/a\\b.js", 0, 2],
      ]);
      expect(both.verdict).toBe("fail");

      const windows = await run("windows");
      expect(windows.diffCoverage?.files.map((f) => [f.path, f.coveredLines, f.coverableLines])).toEqual([
        ["src/a.js", 1, 2],
      ]);
    });
  }
});
