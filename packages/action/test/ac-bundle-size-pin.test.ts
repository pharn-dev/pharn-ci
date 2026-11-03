import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// action-bundle-size AC-4: a vendored TypeScript file whose bytes differ from the pin is refused when a pull request
// makes the built Action parse a test file. The run fails (the Action's exit-2 semantics: a failed step), its `::error::`
// line names the file and both sha256 values, and nothing is reported: no report.json, no job summary, no verdict.
//
// The committed Action (packages/action/dist and packages/action/package.json) is copied into a temp action
// directory, the way a `uses:` checkout holds it, and its dist/index.js is run with a fresh environment the way
// scripts/smoke-release.mjs runs it. The pull request MODIFIES src/math.test.js (only modified or deleted test files
// are parsed), adding a test. The positive control runs the same Action with the intact file over the same repository:
// it must exit 0, write report.json and list src/math.test.js as compared, so the loader's evaluation of the verified
// bytes, its module.exports hand-off and its live-binding swap are exercised end to end in the built bundle.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const COVERAGE = join(ROOT, "fixtures/smoke/coverage.lcov");
const TYPESCRIPT_5_9_3_SHA256 = "3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675";
const RUN_TIMEOUT_MS = 90_000;
const GIT_TIMEOUT_MS = 30_000;
const baseEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };

const MATH_BASE = "export function add(a, b) {\n  return a + b;\n}\n";
const MATH_HEAD = `${MATH_BASE}\nexport function multiply(a, b) {\n  return a * b;\n}\n`;
const ADD_TEST = ['  it("adds two numbers", () => {', "    expect(add(2, 3)).toBe(5);", "  });"];
const MULTIPLY_TEST = ['  it("multiplies two numbers", () => {', "    expect(multiply(2, 3)).toBe(6);", "  });"];
const TEST_BASE = [
  'import { describe, expect, it } from "vitest";',
  'import { add } from "./math.js";',
  "",
  'describe("math", () => {',
  ...ADD_TEST,
  "});",
  "",
].join("\n");
/** The same test file at HEAD with one test added: a modified test file, which the test indexes parse. */
const TEST_HEAD = [
  'import { describe, expect, it } from "vitest";',
  'import { add, multiply } from "./math.js";',
  "",
  'describe("math", () => {',
  ...ADD_TEST,
  "",
  ...MULTIPLY_TEST,
  "});",
  "",
].join("\n");
const TEST_FILE = "src/math.test.js";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

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

/** A repository whose HEAD commit changes src/math.js and modifies src/math.test.js (one test added). */
function buildRepository(repo: string): void {
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src/math.js"), MATH_BASE);
  writeFileSync(join(repo, TEST_FILE), TEST_BASE);
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  writeFileSync(join(repo, "src/math.js"), MATH_HEAD);
  writeFileSync(join(repo, TEST_FILE), TEST_HEAD);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "head");
  mkdirSync(join(repo, "coverage"), { recursive: true });
  cpSync(COVERAGE, join(repo, "coverage/lcov.info"));
}

/** Copies the committed Action into `<dir>/action` and returns its bundle and its vendored TypeScript path. */
/** The bytes of a file the built Action must ship; read once, never checked first (no check-then-use race). */
function readShipped(path: string): Buffer {
  try {
    return readFileSync(path);
  } catch (error) {
    throw new Error(`the built Action ships packages/action/dist/typescript.js: ${String(error)}`);
  }
}

function copyAction(dir: string): { bundle: string; vendored: string } {
  const action = join(dir, "action/packages/action");
  mkdirSync(action, { recursive: true });
  cpSync(join(ROOT, "packages/action/dist"), join(action, "dist"), { recursive: true });
  cpSync(join(ROOT, "packages/action/package.json"), join(action, "package.json"));
  return { bundle: join(action, "dist/index.js"), vendored: join(action, "dist/typescript.js") };
}

type BundleRun = {
  status: number | null;
  stdout: string;
  output: string;
  reportPath: string;
  summary: string;
  outputs: string;
};

/** Runs the bundle in `repo` as scripts/smoke-release.mjs does, with test integrity warn; runner paths under `dir`. */
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
      "INPUT_TEST-INTEGRITY": "warn",
      INPUT_COMMENT: "false",
      "INPUT_GITHUB-TOKEN": "",
      GITHUB_WORKSPACE: repo,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_OUTPUT: outputPath,
      RUNNER_TEMP: runnerTemp,
    },
  });
  return {
    status: run.status,
    stdout: run.stdout ?? "",
    output: `${run.stdout ?? ""}${run.stderr ?? ""}`,
    reportPath: join(runnerTemp, "pharn-ci/report.json"),
    summary: readFileSync(summaryPath, "utf8"),
    outputs: readFileSync(outputPath, "utf8"),
  };
}

describe("action-bundle-size: the built Action refuses a vendored TypeScript file that does not match its pin", () => {
  it("AC-4: with one byte of packages/action/dist/typescript.js changed and a pull request that modifies a test file, the built Action fails the step with an ::error:: line naming the file and both sha256 values, and writes no report.json, no job summary and no verdict", () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-ac-bundle-size-pin-")));
    try {
      const repo = join(tmp, "repo");
      buildRepository(repo);
      const action = copyAction(join(tmp, "tampered"));
      const bytes = readShipped(action.vendored);
      const at = Math.floor(bytes.length / 2);
      bytes[at] = (bytes[at] as number) ^ 0x01;
      writeFileSync(action.vendored, bytes);
      const actual = sha256(bytes);
      expect(actual).not.toBe(TYPESCRIPT_5_9_3_SHA256);

      const run = runBundle(action.bundle, repo, join(tmp, "tampered"));
      expect(run.status, `the run fails the step (exit code 1)\n${run.output}`).toBe(1);
      const errors = run.stdout.split("\n").filter((line) => line.startsWith("::error::"));
      const refusal = errors.find(
        (line) => line.includes(action.vendored) && line.includes(actual) && line.includes(TYPESCRIPT_5_9_3_SHA256),
      );
      expect(
        refusal,
        `an ::error:: line names ${action.vendored}, the file's sha256 ${actual} and the pin ${TYPESCRIPT_5_9_3_SHA256}\n${run.output}`,
      ).toBeDefined();
      expect(existsSync(run.reportPath), "no report.json is written").toBe(false);
      expect(run.summary, "no job summary is written").toBe("");
      expect(run.outputs, "no verdict output is written").not.toMatch(/^verdict(=|<<)/m);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 300_000);

  it("AC-4: (positive control) with packages/action/dist/typescript.js intact, the same run over the same pull request exits 0, writes report.json and lists the modified test file as compared", () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-ac-bundle-size-pin-control-")));
    try {
      const repo = join(tmp, "repo");
      buildRepository(repo);
      const action = copyAction(join(tmp, "intact"));
      expect(existsSync(action.vendored), "the built Action ships packages/action/dist/typescript.js").toBe(true);

      const run = runBundle(action.bundle, repo, join(tmp, "intact"));
      expect(run.status, `the run with the intact file exits 0\n${run.output}`).toBe(0);
      expect(run.stdout, "the run reports no error").not.toMatch(/^::error::/m);
      // report.json is written: the read below throws when it is absent (read once, never checked first).
      const report = JSON.parse(readFileSync(run.reportPath, "utf8")) as {
        testIntegrity?: {
          mode?: unknown;
          languages?: unknown;
          changes?: { files?: { path?: unknown; added?: unknown }[] };
        };
      };
      expect(report.testIntegrity?.mode).toBe("warn");
      expect(report.testIntegrity?.languages, "the js test index parsed the test file").toEqual(["js"]);
      const row = report.testIntegrity?.changes?.files?.find((file) => file.path === TEST_FILE);
      expect(row, `testIntegrity.changes.files lists ${TEST_FILE}`).toBeDefined();
      expect(row?.added, `${TEST_FILE} gains one test`).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 300_000);
});
