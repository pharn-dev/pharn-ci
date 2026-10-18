import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// discoverCoverage and the core choice rule are imported inside the test body: these tests are written before the
// build, so neither module exists yet, and the fixture directories under fixtures/coverage-discovery/ are written
// by the build too. The test lists each fixture directory itself, with its own recursive readdir, and checks that
// the I/O discovery and core's pure choice agree on it.

const ROOT = fileURLToPath(new URL("../../../fixtures/coverage-discovery/", import.meta.url));

const DOTNET_MANY = [
  "tests/App.Tests/TestResults/a1/coverage.cobertura.xml",
  "tests/App.Tests/TestResults/b2/coverage.cobertura.xml",
  "tests/App.Tests/TestResults/c3/coverage.cobertura.xml",
];

const CASES: { dir: string; expected: { kind: string; files?: string[]; found?: string[] } }[] = [
  { dir: "coverage-lcov", expected: { kind: "found", files: ["coverage/lcov.info"] } },
  { dir: "lcov-root", expected: { kind: "found", files: ["lcov.info"] } },
  { dir: "coverage-xml", expected: { kind: "found", files: ["coverage.xml"] } },
  { dir: "cobertura-coverage", expected: { kind: "found", files: ["coverage/cobertura-coverage.xml"] } },
  {
    dir: "dotnet-one",
    expected: { kind: "found", files: ["tests/App.Tests/TestResults/abc/coverage.cobertura.xml"] },
  },
  { dir: "dotnet-many", expected: { kind: "found", files: DOTNET_MANY } },
  { dir: "two-kinds", expected: { kind: "ambiguous", found: ["coverage/lcov.info", "lcov.info"] } },
  { dir: "none", expected: { kind: "not-found" } },
];

/** Every regular file under `dir`, repo-relative with forward slashes. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"));
}

/** The result with its path list sorted, so an ambiguous list compares as a set. */
function normalized(result: { kind: string; files?: string[]; found?: string[] }) {
  return {
    ...result,
    ...(result.found === undefined ? {} : { found: [...result.found].sort() }),
  };
}

describe("discoverCoverage over fixtures/coverage-discovery/", () => {
  it("AC-6: each fixture directory gives the same result as core's choice, and the expected one", async () => {
    const { discoverCoverage } = await import("../src/discovery.js");
    const { listDir } = await import("../src/io.js");
    const { chooseDiscoveredCoverage } = await import("../../core/src/coverageDiscovery.js");
    for (const { dir, expected } of CASES) {
      const repoRoot = join(ROOT, dir);
      const discovered = await discoverCoverage(
        { listDir, resolvePath: (...segments: string[]) => resolve(...segments) },
        repoRoot,
      );
      const chosen = chooseDiscoveredCoverage(filesUnder(repoRoot));
      expect(discovered, dir).toEqual(chosen);
      expect(normalized(discovered as never), dir).toEqual(normalized(expected));
    }
  });
});
