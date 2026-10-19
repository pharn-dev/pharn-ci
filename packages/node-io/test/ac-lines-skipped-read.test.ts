import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// readCoverageFiles, the real file helpers and check() are imported inside the test body: this AC test is written
// before the skipped-records count is carried on parsed entries, so nothing that depends on it may run while the
// file loads.

const CODE = "COVERAGE_LINES_SKIPPED";

type Message = { level: string; code: string; text: string };

// Valid DA records for src/a.ts plus 2 malformed ones (a zero line number and a non-integer line number).
const LCOV = ["TN:", "SF:src/a.ts", "DA:1,1", "DA:0,1", "DA:2,3", "DA:x,1", "end_of_record", ""].join("\n");

// A Cobertura class for src/b.py with valid class-level lines plus 1 malformed line (a zero line number).
const COBERTURA = [
  '<?xml version="1.0" ?>',
  '<coverage line-rate="1" branch-rate="0" version="7.4" timestamp="1">',
  "  <packages>",
  '    <package name="src">',
  "      <classes>",
  '        <class name="b.py" filename="src/b.py">',
  "          <lines>",
  '            <line number="1" hits="1"/>',
  '            <line number="0" hits="1"/>',
  '            <line number="2" hits="2"/>',
  "          </lines>",
  "        </class>",
  "      </classes>",
  "    </package>",
  "  </packages>",
  "</coverage>",
  "",
].join("\n");

// A diff that adds lines 1 and 2 of src/a.ts and of src/b.py, all of them covered.
const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "new file mode 100644",
  "index 0000000..1111111",
  "--- /dev/null",
  "+++ b/src/a.ts",
  "@@ -0,0 +1,2 @@",
  "+export const a = 1;",
  "+export const b = a + 1;",
  "diff --git a/src/b.py b/src/b.py",
  "new file mode 100644",
  "index 0000000..2222222",
  "--- /dev/null",
  "+++ b/src/b.py",
  "@@ -0,0 +1,2 @@",
  "+a = 1",
  "+b = a + 1",
  "",
].join("\n");

describe("readCoverageFiles + check(): skipped records summed across streamed files", () => {
  it("AC-3: two files read as parsed entries give one info COVERAGE_LINES_SKIPPED message with the count 3", async () => {
    const { readCoverageFiles } = await import("../src/coverage.js");
    const { listDir, readFile, readFileStream } = await import("../src/io.js");
    const { check } = await import("../../core/src/check.js");

    const dir = mkdtempSync(join(tmpdir(), "pharn-ci-lines-skipped-"));
    try {
      mkdirSync(join(dir, "coverage"));
      writeFileSync(join(dir, "coverage", "lcov.info"), LCOV);
      writeFileSync(join(dir, "coverage", "coverage.xml"), COBERTURA);

      const files = await readCoverageFiles(
        { listDir, readFile, readFileStream, resolvePath: (...segments: string[]) => resolve(...segments) },
        {
          entries: ["coverage/lcov.info", "coverage/coverage.xml"],
          label: "coverage-file",
          baseDir: dir,
          format: "auto",
          repoRoot: dir,
          name: (entry: string) => entry,
          log: () => {},
        },
      );

      // Both files were streamed and handed over already parsed, never as text.
      expect(files).toHaveLength(2);
      for (const file of files) {
        expect(file).toHaveProperty("parsed");
        expect(file).not.toHaveProperty("text");
      }

      const report = check({
        version: "0.1.0",
        coverage: { files, format: "auto" },
        diff: { text: DIFF },
        repoFiles: ["src/a.ts", "src/b.py"],
        threshold: null,
      });
      expectValidReport(report);
      expect(report.diffCoverage).not.toBeNull();

      const skipped = (report.messages as readonly Message[]).filter((message) => message.code === CODE);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]?.level).toBe("info");
      expect(skipped[0]?.text).toContain("3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
