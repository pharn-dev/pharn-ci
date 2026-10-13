import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// main(), nodeDeps() and the fixtures are loaded inside each test body: the AC tests are written before the coverage
// root and fixtures/coverage-paths/ exist, so nothing that depends on them may run while the file loads. Each test
// builds its own real git repo in a temp directory, inside the test body, and removes it at the end.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const TIMEOUT_MS = 120_000;

type Report = {
  verdict: string;
  diffCoverage: { files: { path: string; coveredLines: number; coverableLines: number }[] } | null;
  agentSetup: unknown;
  messages: { code: string; level: string }[];
};

/**
 * A monorepo whose base commit tracks AGENTS.md, README.md and packages/core/{package.json,src/b.ts}, and whose
 * feature branch adds packages/core/src/a.ts with five lines. Coverage is written after the commits, untracked:
 * coverage/lcov.info is the package-relative fixture, coverage/lcov-abs.info names a.ts by its absolute path.
 */
function makeRepo() {
  // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-coverage-root-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "packages/core/src"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "# Agents\n");
  writeFileSync(join(dir, "README.md"), "# Demo\n");
  writeFileSync(join(dir, "packages/core/package.json"), '{ "name": "core" }\n');
  writeFileSync(join(dir, "packages/core/src/b.ts"), "export const b1 = 1;\nexport const b2 = 2;\n");
  sh("add", ".");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", "feature");
  writeFileSync(
    join(dir, "packages/core/src/a.ts"),
    [1, 2, 3, 4, 5].map((n) => `export const a${n} = ${n};\n`).join(""),
  );
  sh("add", ".");
  sh("commit", "-q", "-m", "feature");
  mkdirSync(join(dir, "coverage"));
  writeFileSync(join(dir, "coverage/lcov.info"), fixture("coverage-paths/package-relative/coverage.info"));
  writeFileSync(
    join(dir, "coverage/lcov-abs.info"),
    `SF:${dir}/packages/core/src/a.ts\nDA:1,1\nDA:2,1\nDA:3,0\nDA:4,1\nDA:5,1\nend_of_record\n`,
  );
  mkdirSync(join(dir, ".pharn"));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
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

const codes = (report: Report) => report.messages.map((message) => message.code);
const measured = (report: Report) =>
  report.diffCoverage?.files.map(({ path, coveredLines, coverableLines }) => ({ path, coveredLines, coverableLines }));

describe("pharn-ci check --coverage-root against a real git repo", () => {
  it(
    "AC-8: the flag decides over coverage.root, an absent flag falls back to it and then to none, and ../x exits 2",
    async () => {
      const { EXIT_ERROR, EXIT_FAIL, EXIT_OK } = await import("../src/main.js");
      const repo = makeRepo();
      try {
        const setConfig = (name: string | null) => {
          const path = join(repo.dir, ".pharn/ci.yml");
          if (name === null) rmSync(path, { force: true });
          else writeFileSync(path, fixture(`coverage-paths/package-relative/${name}`));
        };
        const argv = ["check", "--base", "main", "--format", "json", "--threshold", "80"];
        const argvWithCoverage = [...argv, "--coverage", "coverage/lcov.info"];

        for (const [config, flag, mapped] of [
          [null, "packages/core", true],
          ["ci-root-other.yml", "packages/core", true],
          ["ci-root.yml", "packages/web", false],
          ["ci-root.yml", null, true],
          ["ci-root-other.yml", null, false],
          [null, null, false],
        ] as const) {
          const label = `config ${config ?? "none"}, flag ${flag ?? "absent"}`;
          setConfig(config);
          const run = await runCli(
            repo.dir,
            flag === null ? argvWithCoverage : [...argvWithCoverage, "--coverage-root", flag],
          );
          const report: Report = JSON.parse(run.stdout);
          if (mapped) {
            expect(codes(report), label).not.toContain("COVERAGE_PATHS_UNMATCHED");
            expect(measured(report), label).toEqual([
              { path: "packages/core/src/a.ts", coveredLines: 4, coverableLines: 5 },
            ]);
            expect(report.verdict, label).toBe("pass");
            expect(run.code, label).toBe(EXIT_OK);
          } else {
            expect(codes(report), label).toContain("COVERAGE_PATHS_UNMATCHED");
            expect(report.diffCoverage, label).toBeNull();
            expect(report.verdict, label).toBe("fail");
            expect(run.code, label).toBe(EXIT_FAIL);
          }
        }

        setConfig(null);
        const invalid = await runCli(repo.dir, [...argvWithCoverage, "--coverage-root", "../x"]);
        expect(invalid.code).toBe(EXIT_ERROR);
        expect(invalid.stderr).toContain("--coverage-root");
      } finally {
        repo.remove();
      }
    },
    TIMEOUT_MS,
  );

  it(
    "AC-8: a run from a subdirectory sees the repo's tracked files, so it measures the same diff coverage as a root run",
    async () => {
      const { EXIT_OK } = await import("../src/main.js");
      const repo = makeRepo();
      try {
        const argv = ["check", "--base", "main", "--format", "json", "--threshold", "80"];

        // Coverage paths that are absolute under the repo root, from the root and from packages/core.
        const fromRoot = await runCli(repo.dir, [...argv, "--coverage", "coverage/lcov-abs.info"]);
        const rootReport: Report = JSON.parse(fromRoot.stdout);
        expect(codes(rootReport)).not.toContain("COVERAGE_PATHS_UNMATCHED");
        expect(measured(rootReport)).toEqual([{ path: "packages/core/src/a.ts", coveredLines: 4, coverableLines: 5 }]);

        const subdir = join(repo.dir, "packages/core");
        const fromSubdir = await runCli(subdir, [...argv, "--coverage", "../../coverage/lcov-abs.info"]);
        const subdirReport: Report = JSON.parse(fromSubdir.stdout);
        expect(codes(subdirReport)).not.toContain("COVERAGE_PATHS_UNMATCHED");
        expect(subdirReport.diffCoverage).toEqual(rootReport.diffCoverage);
        expect(fromSubdir.code).toBe(EXIT_OK);
        // The tracked files are the whole repo's, so the agent setup inventory is the root run's (AGENTS.md).
        expect(subdirReport.agentSetup).toEqual(rootReport.agentSetup);

        // Package-relative coverage with --coverage-root, from the subdirectory, is measured at the repo path.
        const relative = await runCli(subdir, [
          ...argv,
          "--coverage",
          "../../coverage/lcov.info",
          "--coverage-root",
          "packages/core",
        ]);
        const relativeReport: Report = JSON.parse(relative.stdout);
        expect(codes(relativeReport)).not.toContain("COVERAGE_PATHS_UNMATCHED");
        expect(measured(relativeReport)).toEqual(measured(rootReport));
        expect(relative.code).toBe(EXIT_OK);
      } finally {
        repo.remove();
      }
    },
    TIMEOUT_MS,
  );
});
