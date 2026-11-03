import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// action-bundle-size AC-3: with test integrity off and a pull request that touches no test file, the built Action never
// loads its vendored TypeScript file, and the report is the same as with the file intact.
//
// The committed Action (packages/action/dist and packages/action/package.json) is copied into a temp action
// directory, the way a `uses:` checkout holds it, and its dist/index.js is run with a fresh environment the way
// scripts/smoke-release.mjs runs it: the six INPUT_* values and the four runner paths only. "Never loaded" is observed
// from outside: the same run with dist/typescript.js removed, and with one of its bytes changed (which the pin refuses
// whenever the file is loaded), still exits 0 and writes a report.json equal to the intact run's.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const COVERAGE = join(ROOT, "fixtures/smoke/coverage.lcov");
const RUN_TIMEOUT_MS = 90_000;
const GIT_TIMEOUT_MS = 30_000;
const baseEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };

const MATH_BASE = "export function add(a, b) {\n  return a + b;\n}\n";
const MATH_HEAD = `${MATH_BASE}\nexport function multiply(a, b) {\n  return a * b;\n}\n`;
/** A test file present, unchanged, at the base and at HEAD: the pull request does not touch it. */
const UNTOUCHED_TEST = [
  'import { describe, expect, it } from "vitest";',
  'import { add } from "./math.js";',
  "",
  'describe("math", () => {',
  '  it("adds two numbers", () => {',
  "    expect(add(2, 3)).toBe(5);",
  "  });",
  "});",
  "",
].join("\n");

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=pharn-ci-ac",
      "-c",
      "user.email=ac@invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    { cwd, env: baseEnv, stdio: "pipe", timeout: GIT_TIMEOUT_MS },
  );
}

/** A repository whose HEAD commit changes src/math.js only; src/math.test.js is the same on both sides. */
function buildRepository(repo: string): void {
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src/math.js"), MATH_BASE);
  writeFileSync(join(repo, "src/math.test.js"), UNTOUCHED_TEST);
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  writeFileSync(join(repo, "src/math.js"), MATH_HEAD);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "head");
  mkdirSync(join(repo, "coverage"), { recursive: true });
  cpSync(COVERAGE, join(repo, "coverage/lcov.info"));
}

/** Copies the committed Action into `<dir>/action` and returns its directory and its vendored TypeScript path. */
function copyAction(dir: string): { bundle: string; vendored: string } {
  const action = join(dir, "action/packages/action");
  mkdirSync(action, { recursive: true });
  cpSync(join(ROOT, "packages/action/dist"), join(action, "dist"), { recursive: true });
  cpSync(join(ROOT, "packages/action/package.json"), join(action, "package.json"));
  return { bundle: join(action, "dist/index.js"), vendored: join(action, "dist/typescript.js") };
}

type BundleRun = { status: number | null; output: string; report: unknown; outputs: string };

/** Runs the bundle in `repo` as scripts/smoke-release.mjs does, with test integrity off; runner paths under `dir`. */
function runBundle(bundle: string, repo: string, dir: string): BundleRun {
  const summaryPath = join(dir, "summary.md");
  const outputPath = join(dir, "output.txt");
  const runnerTemp = join(dir, "runner-temp");
  mkdirSync(runnerTemp, { recursive: true });
  writeFileSync(summaryPath, "");
  writeFileSync(outputPath, "");
  const run = spawnSync(process.execPath, [bundle], {
    cwd: repo,
    encoding: "utf8",
    timeout: RUN_TIMEOUT_MS,
    env: {
      ...baseEnv,
      "INPUT_COVERAGE-FILE": "coverage/lcov.info",
      INPUT_THRESHOLD: "80",
      "INPUT_BASE-REF": "HEAD~1",
      "INPUT_TEST-INTEGRITY": "off",
      INPUT_COMMENT: "false",
      "INPUT_GITHUB-TOKEN": "",
      GITHUB_WORKSPACE: repo,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_OUTPUT: outputPath,
      RUNNER_TEMP: runnerTemp,
    },
  });
  const reportPath = join(runnerTemp, "pharn-ci/report.json");
  return {
    status: run.status,
    output: `${run.stdout ?? ""}${run.stderr ?? ""}`,
    report: existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : null,
    outputs: readFileSync(outputPath, "utf8"),
  };
}

/** The `verdict` output of a GITHUB_OUTPUT file (a `name=value` line or a `name<<DELIM` block). */
function verdictOf(outputs: string): string | undefined {
  const lines = outputs.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith("verdict=")) return line.slice("verdict=".length);
    const block = /^verdict<<(.+)$/.exec(line);
    if (block) return lines[i + 1];
  }
  return undefined;
}

describe("action-bundle-size: a run that parses no test file never loads the vendored TypeScript file", () => {
  it("AC-3: with test-integrity off and a pull request that touches no test file, the built Action exits 0 with packages/action/dist/typescript.js removed and with one of its bytes changed, and writes the same report.json as with the file intact", () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-ac-bundle-size-lazy-")));
    try {
      const repo = join(tmp, "repo");
      buildRepository(repo);

      const intact = copyAction(join(tmp, "intact"));
      expect(existsSync(intact.vendored), "the built Action ships packages/action/dist/typescript.js").toBe(true);
      const baseline = runBundle(intact.bundle, repo, join(tmp, "intact"));
      expect(baseline.status, `the run with the intact file exits 0\n${baseline.output}`).toBe(0);
      expect(baseline.report, "the run with the intact file writes report.json").not.toBeNull();
      expect((baseline.report as { testIntegrity?: { mode?: unknown } }).testIntegrity?.mode).toBe("off");

      const removed = copyAction(join(tmp, "removed"));
      rmSync(removed.vendored);
      const corrupted = copyAction(join(tmp, "corrupted"));
      const bytes = readFileSync(corrupted.vendored);
      const at = Math.floor(bytes.length / 2);
      bytes[at] = (bytes[at] as number) ^ 0x01;
      writeFileSync(corrupted.vendored, bytes);

      for (const [label, action] of [
        ["removed", removed],
        ["corrupted", corrupted],
      ] as const) {
        const run = runBundle(action.bundle, repo, join(tmp, label));
        expect(run.status, `the run with typescript.js ${label} exits 0\n${run.output}`).toBe(0);
        expect(run.output, `the run with typescript.js ${label} reports no error`).not.toMatch(/^::error::/m);
        expect(run.report, `the run with typescript.js ${label} writes the intact run's report.json`).toEqual(
          baseline.report,
        );
        expect(verdictOf(run.outputs), `the run with typescript.js ${label} has the intact run's verdict`).toBe(
          verdictOf(baseline.outputs),
        );
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 300_000);
});
