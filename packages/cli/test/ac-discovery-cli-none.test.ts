import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// main() and nodeDeps() are loaded inside the test body, like the other AC tests written before the build. The
// test builds a real git repo in a temp directory, with no coverage path set and no discovery candidate on disk,
// then removes it.

const TIMEOUT_MS = 120_000;

function makeRepo() {
  // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-discovery-none-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "AGENTS.md"), "# Agents\n");
  writeFileSync(join(dir, "README.md"), "# Demo\n");
  writeFileSync(join(dir, "src/a.ts"), "export const a1 = 1;\n");
  sh("add", ".");
  sh("commit", "-q", "-m", "base");
  const base = sh("rev-parse", "HEAD").trim();
  writeFileSync(join(dir, "src/a.ts"), "export const a1 = 1;\nexport const a2 = 2;\nexport const a3 = 3;\n");
  sh("add", ".");
  sh("commit", "-q", "-m", "change");
  return { dir, base, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

async function runCli(cwd: string, argv: string[]) {
  const { main } = await import("../src/main.js");
  const { nodeDeps } = await import("../src/nodeDeps.js");
  const deps = nodeDeps(cwd);
  let out = "";
  let err = "";
  deps.stdout = (text: string) => {
    out += text;
  };
  deps.stderr = (text: string) => {
    err += text;
  };
  const code = await main(argv, deps);
  return { code, stdout: out, stderr: err };
}

describe("pharn-ci check with no coverage path and no candidate on disk", () => {
  it(
    "AC-10: reports COVERAGE_FILE_MISSING naming the candidates, exit 0 without a threshold and 1 with 80",
    async () => {
      const repo = makeRepo();
      try {
        const argv = ["check", "--format", "json", "--base", repo.base];
        for (const [extra, exit] of [
          [[], 0],
          [["--threshold", "80"], 1],
        ] as const) {
          const label = extra.length === 0 ? "no threshold" : "threshold 80";
          const run = await runCli(repo.dir, [...argv, ...extra]);
          expect(run.code, `${label}: ${run.stderr}`).toBe(exit);
          const report = JSON.parse(run.stdout);
          expectValidReport(report);
          const missing = report.messages.filter(
            (message: { code: string }) => message.code === "COVERAGE_FILE_MISSING",
          );
          expect(missing, label).toHaveLength(1);
          expect(missing[0].text, label).toContain("coverage/lcov.info");
          expect(missing[0].text, label).toContain("**/coverage.cobertura.xml");
          expect(run.stderr, label).not.toContain("(auto-discovered)");
        }
      } finally {
        repo.remove();
      }
    },
    TIMEOUT_MS,
  );
});
