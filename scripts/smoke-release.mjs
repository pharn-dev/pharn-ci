// Release smoke test: runs the built Action bundle against a throwaway git repository and checks what it did.
// It builds the repository from fixtures/smoke/ (a base commit, then the head files copied over it), runs
// <action-dir>/packages/action/dist/index.js with a fresh environment (no token, no event, only the six inputs and
// four runner paths below), and checks, in order and stopping at the first failure:
//   exit     the bundle exits 0
//   verdict  the `verdict` output is `pass`
//   summary  every line of fixtures/smoke/expected-summary.txt is a whole line of the job summary
//   footer   the summary footer names `pharn-ci <version>`, the version in <action-dir>/packages/action/package.json
// Node built-ins only, no network. Needs git on PATH. The temporary directory (under TMPDIR) is removed on every exit.
// Run from the repo root:
//   node scripts/smoke-release.mjs <action-dir>
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RUN_TIMEOUT_MS = 90_000;
const GIT_TIMEOUT_MS = 30_000;
const FIXTURES = fileURLToPath(new URL("../fixtures/smoke/", import.meta.url));

const args = process.argv.slice(2);
if (args.length !== 1) {
  process.stderr.write("usage: node scripts/smoke-release.mjs <action-dir>\n");
  process.exit(2);
}

const actionDir = resolve(process.cwd(), args[0]);
const bundle = join(actionDir, "packages/action/dist/index.js");
const baseEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };

/** Run git in `cwd` with a fixed identity and no signing; `env` has only PATH and HOME. */
function git(cwd, ...gitArgs) {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=pharn-ci-smoke",
      "-c",
      "user.email=smoke@invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "init.defaultBranch=main",
      ...gitArgs,
    ],
    { cwd, env: baseEnv, stdio: "pipe", timeout: GIT_TIMEOUT_MS },
  );
}

/** Parse a GITHUB_OUTPUT file: `name=value` lines and `name<<DELIM` blocks that end at a line equal to DELIM. */
function parseOutputs(text) {
  const outputs = new Map();
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const block = /^([^=<\n]+)<<(.+)$/.exec(line);
    if (block) {
      const value = [];
      i++;
      while (i < lines.length && lines[i] !== block[2]) value.push(lines[i++]);
      outputs.set(block[1], value.join("\n"));
      continue;
    }
    const eq = line.indexOf("=");
    if (eq > 0) outputs.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return outputs;
}

/** The package version of the action under test, or null when it cannot be read. */
function readVersion() {
  try {
    const version = JSON.parse(readFileSync(join(actionDir, "packages/action/package.json"), "utf8")).version;
    return typeof version === "string" && version !== "" ? version : null;
  } catch {
    return null;
  }
}

/** Build the throwaway repository: the base fixture committed, then the head fixture copied over it and committed. */
function buildRepository(repo) {
  mkdirSync(repo, { recursive: true });
  cpSync(join(FIXTURES, "base"), repo, { recursive: true });
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  cpSync(join(FIXTURES, "head"), repo, { recursive: true });
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "head");
  mkdirSync(join(repo, "coverage"), { recursive: true });
  cpSync(join(FIXTURES, "coverage.lcov"), join(repo, "coverage/lcov.info"));
}

/** Returns { check, detail, bundleOutput } for the first failing check, or { ok: line } when every check passes. */
function smoke(tmp) {
  const version = readVersion();
  if (version === null)
    return { check: "version", detail: `no readable version in ${join(actionDir, "packages/action/package.json")}` };
  if (!existsSync(bundle)) return { check: "exit", detail: `no bundle at ${bundle}` };

  const repo = join(tmp, "repo");
  const summaryPath = join(tmp, "summary.md");
  const outputPath = join(tmp, "output.txt");
  const runnerTemp = join(tmp, "runner-temp");
  buildRepository(repo);
  writeFileSync(summaryPath, "");
  writeFileSync(outputPath, "");
  mkdirSync(runnerTemp, { recursive: true });

  const run = spawnSync(process.execPath, [bundle], {
    cwd: repo,
    encoding: "utf8",
    timeout: RUN_TIMEOUT_MS,
    env: {
      ...baseEnv,
      "INPUT_COVERAGE-FILE": "coverage/lcov.info",
      INPUT_THRESHOLD: "80",
      "INPUT_BASE-REF": "HEAD~1",
      "INPUT_TEST-INTEGRITY": "block",
      INPUT_COMMENT: "false",
      "INPUT_GITHUB-TOKEN": "",
      GITHUB_WORKSPACE: repo,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_OUTPUT: outputPath,
      RUNNER_TEMP: runnerTemp,
    },
  });
  const bundleOutput = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const fail = (check, detail) => ({ check, detail, bundleOutput });

  if (run.status !== 0) {
    const how = run.status === null ? `signal ${run.signal ?? "unknown"}` : `exit code ${run.status}`;
    return fail("exit", `${how}, expected 0`);
  }

  const verdict = parseOutputs(readFileSync(outputPath, "utf8")).get("verdict");
  if (verdict !== "pass") return fail("verdict", `verdict "${verdict ?? ""}", expected "pass"`);

  const summaryLines = readFileSync(summaryPath, "utf8")
    .split("\n")
    .map((line) => line.replace(/\r$/, ""));
  const expected = readFileSync(join(FIXTURES, "expected-summary.txt"), "utf8")
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim() !== "");
  const missing = expected.find((line) => !summaryLines.includes(line));
  if (missing !== undefined) return fail("summary", `the job summary has no line "${missing}"`);

  const footer = new RegExp(`pharn-ci ${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9.])`);
  if (!summaryLines.some((line) => footer.test(line))) {
    return fail("footer", `footer: no "pharn-ci ${version}" in the job summary`);
  }

  return { ok: `ok pharn-ci ${version}: exit 0, verdict pass, ${expected.length} summary lines, footer` };
}

const tmp = mkdtempSync(join(tmpdir(), "pharn-ci-smoke-"));
let result;
try {
  result = smoke(tmp);
} catch (error) {
  result = { check: "setup", detail: error instanceof Error ? error.message : String(error) };
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (result.ok) {
  process.stdout.write(`${result.ok}\n`);
} else {
  let message = `smoke failed: ${result.check}: ${result.detail}\n`;
  if (result.bundleOutput) {
    const indented = result.bundleOutput.replace(/\n$/, "").replaceAll(/^/gm, "  ");
    message += `--- bundle output ---\n${indented}\n`;
  }
  process.stderr.write(message);
  process.exitCode = 1;
}
