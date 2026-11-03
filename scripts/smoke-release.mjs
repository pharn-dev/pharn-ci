// Release smoke test: runs the built Action bundle against a throwaway git repository and checks what it did.
// It builds the repository from fixtures/smoke/ (a base commit, then the head files copied over it), runs
// <action-dir>/packages/action/dist/index.js with a fresh environment (no token, no event, only the six inputs and
// four runner paths below), and checks, in order and stopping at the first failure:
//   exit     the bundle exits 0
//   verdict  the `verdict` output is `pass`
//   summary  every line of fixtures/smoke/expected-summary.txt is a whole line of the job summary
//   footer   the summary footer names `pharn-ci <version>`, the version in <action-dir>/packages/action/package.json
//   offline  a second run of the same bundle in the same repository, with the network forbidden, ends the same: the
//            OIDC request variables are set (the token URL is a closed 127.0.0.1 port), a run context (a synthetic
//            event file with a repository name, a run id and the head SHA) lets the org policy and the upload reach
//            their token request, and a preload makes the global fetch throw. It must exit as the first run did, with
//            the same `verdict`, log that the upload found no OIDC token, and write a report.json equal to the first
//            run's except `meta`: only this run has a run context, so only its report has `meta`, and `meta.upload`
//            must be `skipped`.
// Node built-ins only, no network. Needs git on PATH. The temporary directory (under TMPDIR) is removed on every exit.
// Run from the repo root:
//   node scripts/smoke-release.mjs <action-dir>
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const RUN_TIMEOUT_MS = 90_000;
/** The OIDC token URL of the offline run: port 1 of the loopback address, where nothing listens. */
const DEAD_TOKEN_URL = "http://127.0.0.1:1/token";
/** A preload for the offline run: every call of the global fetch rejects, as it does with no network. */
const NO_FETCH_PRELOAD =
  "data:text/javascript,globalThis.fetch = async () => { throw new TypeError('smoke: the network is forbidden'); };";
/** The line the upload logs when it asked for an OIDC token and got none. */
const UPLOAD_NO_TOKEN_LINE = "pharn-ci: the run is not uploaded to pharn.dev: no OIDC token is available";
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
  buildRepository(repo);

  const first = runBundle(repo, join(tmp, "online"));
  const fail = (check, detail) => ({ check, detail, bundleOutput: first.output });

  if (first.status !== 0) return fail("exit", `${exitText(first)}, expected 0`);

  const verdict = first.verdict();
  if (verdict !== "pass") return fail("verdict", `verdict "${verdict ?? ""}", expected "pass"`);

  const summaryLines = readFileSync(first.summaryPath, "utf8")
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

  const offline = offlineCheck(repo, join(tmp, "offline"), first);
  if (offline !== null) return offline;

  return {
    ok: `ok pharn-ci ${version}: exit 0, verdict pass, ${expected.length} summary lines, footer, offline run matches`,
  };
}

/**
 * Runs the bundle once in `repo` with the six inputs and four runner paths (under `dir`), plus `extraEnv`, and node
 * flags `nodeArgs`. Returns the exit, the output, and readers of the `verdict` output and of report.json.
 */
function runBundle(repo, dir, extraEnv = {}, nodeArgs = []) {
  const summaryPath = join(dir, "summary.md");
  const outputPath = join(dir, "output.txt");
  const runnerTemp = join(dir, "runner-temp");
  mkdirSync(runnerTemp, { recursive: true });
  writeFileSync(summaryPath, "");
  writeFileSync(outputPath, "");
  const run = spawnSync(process.execPath, [...nodeArgs, bundle], {
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
      ...extraEnv,
    },
  });
  return {
    status: run.status,
    signal: run.signal,
    output: `${run.stdout ?? ""}${run.stderr ?? ""}`,
    summaryPath,
    verdict: () => parseOutputs(readFileSync(outputPath, "utf8")).get("verdict"),
    /** The parsed report.json, or null when it is missing or not JSON. */
    report: () => {
      try {
        return JSON.parse(readFileSync(join(runnerTemp, "pharn-ci/report.json"), "utf8"));
      } catch {
        return null;
      }
    },
  };
}

function exitText(run) {
  return run.status === null ? `signal ${run.signal ?? "unknown"}` : `exit code ${run.status}`;
}

/**
 * The offline run (see the header): null when it ends as `first` did, else the failure. The run context is what lets
 * the policy and the upload get as far as the token request; without a repository name the policy stops earlier.
 */
function offlineCheck(repo, dir, first) {
  mkdirSync(dir, { recursive: true });
  const eventPath = join(dir, "event.json");
  writeFileSync(eventPath, `${JSON.stringify({ repository: { full_name: "pharn-ci-smoke/repo" } })}\n`);
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    env: baseEnv,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
  }).trim();
  const run = runBundle(
    repo,
    dir,
    {
      ACTIONS_ID_TOKEN_REQUEST_URL: DEAD_TOKEN_URL,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "smoke-not-a-token",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_RUN_ID: "1",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_SHA: headSha,
    },
    [`--import=${NO_FETCH_PRELOAD}`],
  );
  const fail = (detail) => ({ check: "offline", detail, bundleOutput: run.output });

  if (run.status !== first.status) return fail(`${exitText(run)}, expected ${exitText(first)} as the first run`);
  const verdict = run.verdict();
  const firstVerdict = first.verdict();
  if (verdict !== firstVerdict) return fail(`verdict "${verdict ?? ""}", expected "${firstVerdict}" as the first run`);
  if (!run.output.split("\n").some((line) => line.replace(/\r$/, "") === UPLOAD_NO_TOKEN_LINE)) {
    return fail(`no line "${UPLOAD_NO_TOKEN_LINE}": the upload did not reach its token request`);
  }
  const report = run.report();
  const firstReport = first.report();
  if (report === null || firstReport === null) return fail("a run wrote no readable report.json");
  if (report.meta?.upload?.status !== "skipped") return fail("report.json meta.upload is not skipped");
  if ("meta" in firstReport) return fail("the first run's report.json has meta, expected none");
  const { meta: _meta, ...rest } = report;
  if (!isDeepStrictEqual(rest, firstReport)) {
    const keys = [...new Set([...Object.keys(rest), ...Object.keys(firstReport)])].filter(
      (key) => !isDeepStrictEqual(rest[key], firstReport[key]),
    );
    return fail(`report.json differs from the first run's beyond meta, in: ${keys.join(", ")}`);
  }
  return null;
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
