import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// E3 item 24 (P07), AC-23. Reads the tree with git against the base commit and runs the named whole-report tests, the
// render goldens and every ac-p11-* and ac-polrules-* test in a child vitest; nothing the build adds is loaded here.
// The child's PHARN_TEST_RESULTS is removed, so vitest.config.ts never points it at the gate's own results file; its
// JSON report goes to a temporary file. ac-p11-unchanged.test.ts is left out of the child: it starts a child vitest of
// its own, and the whole suite runs it anyway.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "c6b685b";
const MARK = "E3 item 24 (P07)";
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const nonEmpty = (text: string) => text.split("\n").filter((l) => l.length > 0);

/** The tests PLAN.md step 9 lists as deliberately re-pinned; each must carry a comment naming this item. */
const DELIBERATE = [
  "packages/action/test/ac-pyparity2-unchanged.test.ts",
  "packages/core/test/ac-precision-v030-schema.test.ts",
  "packages/core/test/ac-secrets-repin.test.ts",
  "packages/core/test/ac-upload-schema.test.ts",
  "packages/core/test/ac-polrules-docs.test.ts",
  "packages/core/test/ac-p11-schema-hints.test.ts",
  "packages/core/test/ac-upload-docs.test.ts",
  "packages/core/test/ac-p11-unchanged.test.ts",
];

/** The whole-report tests and render goldens that must pass unchanged. */
const NAMED = [
  "packages/action/test/ac-stream-action.test.ts",
  "packages/cli/test/ac-stream-adapters.test.ts",
  "packages/core/test/golden.test.ts",
  "packages/core/test/markdown.test.ts",
  "packages/core/test/ac-report-v2-golden.test.ts",
];

interface AssertionResult {
  title: string;
  status: string;
  failureMessages: string[];
}
interface JsonReport {
  numFailedTests: number;
  numPendingTests: number;
  testResults: { name: string; status: string; message?: string; assertionResults: AssertionResult[] }[];
}

describe("existing tests, fixtures and goldens stay as they are", () => {
  it("AC-23: only new fixtures under fixtures/policy-rules/p07/, no test file deleted, every deliberate re-pin marked, and the whole-report, render-golden, ac-p11-* and ac-polrules-* tests pass", () => {
    // Fixtures: no tracked file under fixtures/ is modified or deleted; anything new is under fixtures/policy-rules/p07/.
    for (const line of nonEmpty(git("diff", "--name-status", "--no-renames", BASE, "--", "fixtures/"))) {
      // Re-pinned on the rebase onto E3 item 23 (policy settings): its fixtures under fixtures/policy-settings/ are new too.
      expect(line, "a fixture change").toMatch(
        /^A\tfixtures\/policy-rules\/p07\/[^/]+\/[^/]+$|^A\tfixtures\/policy-settings\/[^\t]+$/,
      );
    }
    for (const path of nonEmpty(git("ls-files", "--others", "--exclude-standard", "--", "fixtures/"))) {
      expect(path, "a new fixture").toMatch(/^fixtures\/policy-rules\/p07\/[^/]+\/[^/]+$/);
    }

    // No existing test file is deleted. A rename is not a deletion: the 0.4.0 release PR renamed the release-030 pin
    // tests (version, dist, readme-pins, doc-pins) to release-040, with the version pins moved on.
    expect(git("diff", "--name-only", "--diff-filter=D", BASE, "--", "packages/")).toBe("");

    // Each deliberate re-pin carries a comment naming this item.
    for (const path of DELIBERATE) {
      const lines = read(path).split("\n");
      expect(
        lines.some((l) => /^\s*(\/\/|\/\*|\*)/.test(l) && l.includes(MARK)),
        `${path} names "${MARK}" in a comment`,
      ).toBe(true);
    }

    // The named tests, every ac-p11-* and every ac-polrules-* test, run in a child vitest.
    const tracked = nonEmpty(
      git("ls-files", "--", "packages/*/test/ac-p11-*.test.ts", "packages/*/test/ac-polrules-*.test.ts"),
    ).filter((p) => p !== "packages/core/test/ac-p11-unchanged.test.ts");
    expect(tracked).toContain("packages/core/test/ac-p11-render.test.ts");
    expect(tracked).toContain("packages/core/test/ac-polrules-report.test.ts");
    const files = [...NAMED, ...tracked];

    const outDir = mkdtempSync(join(tmpdir(), "pharn-ci-p07-unchanged-"));
    const out = join(outDir, "report.json");
    try {
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.PHARN_TEST_RESULTS;
      const child = spawnSync(
        process.execPath,
        [join(ROOT, "node_modules/vitest/vitest.mjs"), "run", ...files, "--reporter=json", `--outputFile=${out}`],
        { cwd: ROOT, env, encoding: "utf8", timeout: 420_000 },
      );
      expect(
        existsSync(out),
        `the child wrote its JSON report (exit ${child.status}): ${child.stderr.slice(-2000)}`,
      ).toBe(true);
      const report = JSON.parse(readFileSync(out, "utf8")) as JsonReport;
      for (const file of files) {
        const result = report.testResults.find((r) => r.name.split("\\").join("/").endsWith(file));
        expect(result, `${file} ran`).toBeDefined();
        const tests = result?.assertionResults ?? [];
        expect(tests.length, `${file}: tests collected`).toBeGreaterThan(0);
        for (const t of tests) expect(t.status, `${file} › ${t.title}: ${t.failureMessages.join("\n")}`).toBe("passed");
      }
      expect(report.numFailedTests).toBe(0);
      expect(report.numPendingTests).toBe(0);
      expect(child.status).toBe(0);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 480_000);
});
