import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// discoverCoverage is imported inside the test body: it is written by the build. The repo root is a temp
// directory built in the test body (git ignores node_modules/, and symbolic links are fragile in fixtures), and
// removed at the end.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

function write(root: string, path: string, text: string) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

describe("discoverCoverage: node_modules, directories and symbolic links", () => {
  it("AC-7: no file under node_modules, no directory and no symbolic link counts as a candidate", async () => {
    const { discoverCoverage } = await import("../src/discovery.js");
    const { listDir } = await import("../src/io.js");
    const root = mkdtempSync(join(tmpdir(), "pharn-ci-discovery-rules-"));
    try {
      const cobertura = fixture("golden-cobertura/coverage.xml");
      write(root, "node_modules/coverage.cobertura.xml", cobertura);
      write(root, "node_modules/pkg/TestResults/x/coverage.cobertura.xml", cobertura);
      write(root, "packages/a/node_modules/dep/coverage.cobertura.xml", cobertura);
      mkdirSync(join(root, "coverage.xml"));
      write(root, "elsewhere/real.info", fixture("golden/coverage.info"));
      symlinkSync(join(root, "elsewhere/real.info"), join(root, "lcov.info"));
      write(root, "src/a.ts", "export const a = 1;\n");

      const result = await discoverCoverage(
        { listDir, resolvePath: (...segments: string[]) => resolve(...segments) },
        root,
      );
      expect(result).toEqual({ kind: "not-found" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
