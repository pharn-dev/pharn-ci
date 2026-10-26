import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A child vitest runs the two python3-dependent test files with a PATH that holds only links to node and git, so no
// python3 can be found. Nothing the build adds is loaded here. The child's PHARN_TEST_RESULTS is removed, so
// vitest.config.ts never points it at the gate's own results file; its JSON report goes to a temporary file.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FILES = ["packages/node-io/test/ac-ti0205-python.test.ts", "packages/cli/test/ac-ti0205-cli.test.ts"];
/** The python3 version each of the two files checks for today. */
const VERSION = "3.8";

interface AssertionResult {
  title: string;
  fullName?: string;
  status: string;
  failureMessages: string[];
}
interface JsonReport {
  numPendingTests: number;
  numTodoTests?: number;
  testResults: { name: string; status: string; message?: string; assertionResults: AssertionResult[] }[];
}

describe("the python3-dependent tests fail, never skip, without python3", () => {
  it("AC-11: with no python3 on PATH, vitest reports every python3-dependent test of ac-ti0205-python.test.ts and ac-ti0205-cli.test.ts failed with a message naming python3 and 3.8, and zero skipped tests", () => {
    const bin = mkdtempSync(join(tmpdir(), "pharn-ci-no-python-"));
    const out = join(mkdtempSync(join(tmpdir(), "pharn-ci-no-python-out-")), "report.json");
    try {
      symlinkSync(process.execPath, join(bin, "node"));
      const git = join(execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(), "git");
      expect(existsSync(git), `git at ${git}`).toBe(true);
      symlinkSync(git, join(bin, "git"));

      const env: NodeJS.ProcessEnv = { ...process.env, PATH: bin };
      delete env.PHARN_TEST_RESULTS;
      const probe = spawnSync("python3", ["--version"], { env, encoding: "utf8" });
      expect(probe.error, "no python3 is found on the child's PATH").toBeDefined();

      const child = spawnSync(
        process.execPath,
        [join(ROOT, "node_modules/vitest/vitest.mjs"), "run", ...FILES, "--reporter=json", `--outputFile=${out}`],
        { cwd: ROOT, env, encoding: "utf8", timeout: 240_000 },
      );
      expect(
        existsSync(out),
        `the child wrote its JSON report (exit ${child.status}): ${child.stderr.slice(-2000)}`,
      ).toBe(true);
      const report = JSON.parse(readFileSync(out, "utf8")) as JsonReport;

      const byFile = (file: string) => {
        const result = report.testResults.find((r) => r.name.split("\\").join("/").endsWith(file));
        expect(result, `${file} ran`).toBeDefined();
        return (result as JsonReport["testResults"][number]).assertionResults;
      };
      const python = byFile(FILES[0] as string);
      const cli = byFile(FILES[1] as string);

      expect(report.numPendingTests, "no skipped test").toBe(0);
      expect(report.numTodoTests ?? 0, "no todo test").toBe(0);
      for (const t of [...python, ...cli]) {
        expect(["skipped", "pending", "todo", "disabled"], `${t.title}: not skipped`).not.toContain(t.status);
      }

      // Every test of the node-io file runs the Python index, so every one needs python3.
      expect(python.length, "the node-io file's tests were collected").toBeGreaterThanOrEqual(4);
      const needing = [...python, ...cli.filter((t) => t.title.includes("--test-integrity block"))];
      expect(needing.length, "the CLI test that runs the Python index").toBe(python.length + 1);
      for (const t of needing) {
        expect(t.status, `${t.title}: failed`).toBe("failed");
        const message = t.failureMessages.join("\n");
        expect(message, `${t.title}: names python3`).toContain("python3");
        expect(message, `${t.title}: names ${VERSION}`).toContain(VERSION);
      }
    } finally {
      rmSync(bin, { recursive: true, force: true });
      rmSync(join(out, ".."), { recursive: true, force: true });
    }
  }, 300_000);
});
