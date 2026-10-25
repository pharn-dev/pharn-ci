// Runs the built CLI over every PR of the frozen precision corpus and writes the review CSV that a person then rates by
// hand (see docs/PRECISION.md section 2). A dev-only maintainer script, never part of the Action or the CLI; nothing the
// Action bundles imports it. It uses Node built-ins only.
//
//   node scripts/corpus-run.mjs [--corpus <dir>] [--cache <dir>] [--out <file.csv>] [--repo owner/name] [--limit n]
//                               [--cli <file>] [--jobs n] [--timeout <seconds>]
//
// Per repository it makes one blobless clone in the cache; per PR it fetches the two shas, adds a detached worktree at
// the head sha, runs `check --base <baseSha> --test-integrity block --format json` there, turns the signals of the
// report into CSV rows and removes the worktree. It reaches github.com only through git (no GitHub API, no PR titles
// or bodies, no telemetry). It never installs dependencies, never runs a cloned repository's scripts or hooks (git
// hooks are switched off, LFS smudge is off) and never writes a cloned repository's configuration.
//
// The CSV is rewritten whole, sorted, after every PR; a rerun skips the PRs already in `--out` and keeps their rows
// (and any verdicts typed into them) unchanged. A PR that cannot be run gets one `error` row and the run goes on.
//
// Exit codes: 0 the CSV was written (error rows included), 1 corpus or output I/O failed, 2 usage error (before any git
// call, any cache directory or any output file).
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errorRow, isReport, parseCsv, rowsFromReport, serializeCsv } from "./corpus-lib.mjs";

const USAGE =
  "usage: node scripts/corpus-run.mjs [--corpus <dir>] [--cache <dir>] [--out <file.csv>] [--repo owner/name] [--limit n] [--cli <file>] [--jobs n] [--timeout <seconds>]";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DETAIL_MAX = 300;

// Environment variables that could point git at another repository when this script runs inside a git hook.
const GIT_LOCATION_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
];

// --- Arguments -----------------------------------------------------------------------------------------

// Pure flag parsing: { options } or { error }. No exit and no I/O here, so tests can call it.
export function parseArgs(argv, env = {}) {
  const known = [
    "--corpus",
    "--cache",
    "--out",
    "--repo",
    "--limit",
    "--cli",
    "--jobs",
    "--timeout",
    "--remote-url-template",
  ];
  const values = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!known.includes(flag)) return { error: `unknown option ${flag}` };
    const value = argv[i + 1];
    if (value === undefined) return { error: `missing value for ${flag}` };
    if (values.has(flag)) return { error: `${flag} given twice` };
    values.set(flag, value);
  }

  for (const flag of ["--corpus", "--cache", "--out", "--cli", "--remote-url-template"]) {
    if (values.get(flag) === "") return { error: `${flag} needs a value` };
  }
  const number = (flag, fallback) => {
    if (!values.has(flag)) return fallback;
    const text = values.get(flag);
    return /^[1-9]\d*$/.test(text) ? Number(text) : Number.NaN;
  };
  const jobs = number("--jobs", 1);
  if (Number.isNaN(jobs)) return { error: `--jobs needs a positive integer, got ${values.get("--jobs")}` };
  const limit = number("--limit", undefined);
  if (Number.isNaN(limit)) return { error: `--limit needs a positive integer, got ${values.get("--limit")}` };
  const timeout = number("--timeout", 300);
  if (Number.isNaN(timeout)) return { error: `--timeout needs a positive integer, got ${values.get("--timeout")}` };

  const repo = values.get("--repo");
  if (repo !== undefined && !REPO_PATTERN.test(repo)) return { error: `--repo needs owner/name, got ${repo}` };

  const corpus = values.has("--corpus") ? resolve(values.get("--corpus")) : join(ROOT, "fixtures", "corpus");
  const cli = values.has("--cli") ? resolve(values.get("--cli")) : join(ROOT, "packages", "cli", "dist", "index.js");
  const envCache =
    typeof env.PHARN_CORPUS_CACHE === "string" && env.PHARN_CORPUS_CACHE !== "" ? env.PHARN_CORPUS_CACHE : null;
  const cache = resolve(values.get("--cache") ?? envCache ?? join(homedir(), ".cache", "pharn-ci-corpus"));
  const out = values.has("--out") ? resolve(values.get("--out")) : join(cache, "corpus-run.csv");

  return {
    options: {
      corpus,
      cache,
      out,
      repo,
      limit,
      cli,
      jobs,
      timeout,
      remoteUrlTemplate: values.get("--remote-url-template") ?? "https://github.com/{repo}.git",
    },
  };
}

// --- Corpus ----------------------------------------------------------------------------------------------

// Reads and validates every `*.json` corpus file, sorted by file name. Throws an Error naming the file.
function loadCorpus(dir) {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return files.map((name) => {
    const path = join(dir, name);
    let doc;
    try {
      doc = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof doc?.repo !== "string" || !REPO_PATTERN.test(doc.repo))
      throw new Error(`${path}: repo must be owner/name`);
    if (!Array.isArray(doc.prs)) throw new Error(`${path}: prs must be an array`);
    const prs = doc.prs.map((entry, index) => {
      const where = `${path}: prs[${index}]`;
      if (!Number.isInteger(entry?.number) || entry.number <= 0)
        throw new Error(`${where}: number must be a positive integer`);
      for (const key of ["baseSha", "headSha"]) {
        if (typeof entry[key] !== "string" || !SHA_PATTERN.test(entry[key]))
          throw new Error(`${where}: ${key} must be 40 lower-case hex digits`);
      }
      return { number: entry.number, baseSha: entry.baseSha, headSha: entry.headSha };
    });
    return { repo: doc.repo, prs };
  });
}

// --- Processes -------------------------------------------------------------------------------------------

const live = new Set();
let shuttingDown = false;
function killAll() {
  shuttingDown = true;
  for (const child of live) killTree(child);
}
function killTree(child) {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

// The environment for git and the CLI: no variable that relocates git, LFS smudge and prompts off, hooks off.
function cleanEnv(base) {
  const env = { ...base };
  for (const name of GIT_LOCATION_VARIABLES) delete env[name];
  env.GIT_LFS_SKIP_SMUDGE = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  const existing = Number.parseInt(env.GIT_CONFIG_COUNT ?? "0", 10);
  const count = Number.isInteger(existing) && existing >= 0 ? existing : 0;
  env[`GIT_CONFIG_KEY_${count}`] = "core.hooksPath";
  env[`GIT_CONFIG_VALUE_${count}`] = "/dev/null";
  env.GIT_CONFIG_COUNT = String(count + 1);
  return env;
}

// Spawns a command with stdin closed and its own timer; resolves { code, signal, stdout, stderr, timedOut, spawnError }.
function run(command, args, { cwd, env, timeoutMs }) {
  return new Promise((resolvePromise) => {
    const out = [];
    const err = [];
    let timedOut = false;
    let spawnError = null;
    let finished = false;
    let timer;
    let backstop;
    let child;

    const finish = (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(backstop);
      if (child) live.delete(child);
      resolvePromise({
        code,
        signal,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        timedOut,
        spawnError,
      });
    };

    try {
      child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    } catch (error) {
      spawnError = error instanceof Error ? error.message : String(error);
      finish(null, null);
      return;
    }
    live.add(child);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", (error) => {
      spawnError = error.message;
      finish(null, null);
    });
    child.on("close", (code, signal) => finish(code, signal));
    timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      // A grandchild that kept the pipes open must not hold the run up.
      backstop = setTimeout(() => finish(null, "SIGKILL"), 5000);
    }, timeoutMs);
  });
}

// --- Git -------------------------------------------------------------------------------------------------

const GIT_PREFIX_ARGS = ["-c", "core.hooksPath=/dev/null", "-c", "gc.auto=0", "-c", "maintenance.auto=false"];

function createGit(env) {
  const gitEnv = cleanEnv(env);
  return (args, { cwd, timeoutMs = 600_000 } = {}) =>
    run("git", [...GIT_PREFIX_ARGS, ...args], { cwd, env: gitEnv, timeoutMs });
}

const firstLine = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "");

const clip = (text) => (text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text);

// The first non-empty stderr line of a failed git call, or a fallback text.
const gitProblem = (result, fallback) => clip(firstLine(result.stderr) ?? result.spawnError ?? fallback);

const ok = (result) => result.code === 0 && !result.timedOut && result.spawnError === null;

// --- One PR ----------------------------------------------------------------------------------------------

function cliProblem(result, timeout) {
  if (result.spawnError !== null) return clip(result.spawnError);
  if (result.timedOut) return `timed out after ${timeout} s`;
  const line = firstLine(result.stderr);
  if (line !== undefined) return clip(line);
  if (result.code === 0 || result.code === 1) return "output is not a JSON report";
  return result.code === null ? `killed by ${result.signal ?? "a signal"}` : `exit code ${result.code}`;
}

// The CLI's rows for one PR: signal rows, a `none` row, or one `error` row.
function rowsOfCliRun(repo, pr, result, timeout) {
  if ((result.code === 0 || result.code === 1) && !result.timedOut && result.spawnError === null) {
    try {
      const report = JSON.parse(result.stdout);
      if (isReport(report)) return rowsFromReport(repo, pr, report);
    } catch {
      // falls through to the error row
    }
  }
  return [errorRow(repo, pr, cliProblem(result, timeout))];
}

// --- The run ---------------------------------------------------------------------------------------------

async function runCorpus(options, selected, kept) {
  const git = createGit(process.env);
  const cliEnv = cleanEnv(process.env);
  const rows = [...kept];
  const locks = new Map();
  const clones = new Map();
  const queue = [...selected];
  let writeFailed = null;
  let writing = Promise.resolve();

  const withLock = (repo, fn) => {
    const next = (locks.get(repo) ?? Promise.resolve()).then(fn);
    locks.set(
      repo,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  };

  const writeCsv = () => {
    writing = writing.then(() => {
      try {
        const tmp = `${options.out}.tmp`;
        writeFileSync(tmp, serializeCsv(rows));
        renameSync(tmp, options.out);
      } catch (error) {
        writeFailed = error;
      }
    });
    return writing;
  };

  // Called under the repository's lock. Returns null when the clone is usable, else the reason.
  const ensureClone = async (repo) => {
    if (clones.has(repo)) return clones.get(repo);
    const dir = join(options.cache, repo.replace("/", "__"));
    let problem = null;
    if (existsSync(dir)) {
      const result = await git(["rev-parse", "--absolute-git-dir"], { cwd: dir });
      let isClone = false;
      if (ok(result)) {
        try {
          isClone = realpathSync(result.stdout.trim()) === join(realpathSync(dir), ".git");
        } catch {
          isClone = false;
        }
      }
      if (!isClone) problem = `clone failed: ${dir} exists and is not a git clone`;
    } else {
      const url = options.remoteUrlTemplate.replaceAll("{repo}", repo);
      const result = await git(["clone", "--filter=blob:none", "--no-checkout", url, dir], { cwd: options.cache });
      if (!ok(result)) problem = `clone failed: ${gitProblem(result, "git clone failed")}`;
    }
    clones.set(repo, problem);
    return problem;
  };

  const cleanup = async (clone, path) => {
    const removed = await git(["worktree", "remove", path], { cwd: clone });
    if (!ok(removed)) await git(["worktree", "remove", "--force", path], { cwd: clone });
    await git(["worktree", "prune"], { cwd: clone });
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // a cleanup failure never stops the run
    }
  };

  // Fetch both shas, then add a detached worktree at the head sha. Under the repository's lock.
  const prepare = async (repo, pr, clone, worktree) => {
    const cloneProblem = await ensureClone(repo);
    if (cloneProblem !== null) return { error: cloneProblem };

    const fetchArgs = ["fetch", "--no-tags", "--no-write-fetch-head", "origin"];
    // The two shas directly; if the server refuses them, the base sha plus GitHub's pull/<n>/head ref.
    const direct = await git([...fetchArgs, pr.headSha, pr.baseSha], { cwd: clone });
    let fetchProblem = ok(direct) ? null : gitProblem(direct, "fetch failed");
    if (fetchProblem !== null) {
      const refspec = `+refs/pull/${pr.number}/head:refs/pharn-corpus/pull/${pr.number}`;
      const viaRef = await git([...fetchArgs, pr.baseSha, refspec], { cwd: clone });
      if (ok(viaRef)) fetchProblem = null;
    }
    if (fetchProblem === null) {
      for (const sha of [pr.headSha, pr.baseSha]) {
        const check = await git(["cat-file", "-e", `${sha}^{commit}`], { cwd: clone });
        if (!ok(check)) fetchProblem = `fetch failed: ${sha} is not in the clone`;
      }
    }
    if (fetchProblem !== null) return { error: fetchProblem };

    if (existsSync(worktree)) await cleanup(clone, worktree);
    await git(["worktree", "prune"], { cwd: clone });
    mkdirSync(dirname(worktree), { recursive: true });
    const added = await git(["worktree", "add", "--detach", worktree, pr.headSha], { cwd: clone });
    if (!ok(added)) return { error: gitProblem(added, "git worktree add failed") };
    return { error: null };
  };

  const processPr = async ({ repo, pr }) => {
    const clone = join(options.cache, repo.replace("/", "__"));
    const worktree = join(options.cache, ".worktrees", `${repo.replace("/", "__")}-${pr.number}`);
    let touched = false;
    try {
      const prepared = await withLock(repo, () => {
        touched = true;
        return prepare(repo, pr, clone, worktree);
      });
      if (prepared.error !== null) return [errorRow(repo, pr.number, prepared.error)];

      const result = await run(
        process.execPath,
        [options.cli, "check", "--base", pr.baseSha, "--test-integrity", "block", "--format", "json"],
        { cwd: worktree, env: cliEnv, timeoutMs: options.timeout * 1000 },
      );
      return rowsOfCliRun(repo, pr.number, result, options.timeout);
    } catch (error) {
      return [errorRow(repo, pr.number, clip(error instanceof Error ? error.message : String(error)))];
    } finally {
      if (touched && existsSync(clone)) await withLock(repo, () => cleanup(clone, worktree)).catch(() => undefined);
    }
  };

  const worker = async () => {
    for (let item = queue.shift(); item !== undefined && !shuttingDown; item = queue.shift()) {
      const added = await processPr(item);
      rows.push(...added);
      const kind = added[0]?.signal;
      const summary = kind === "none" ? "none" : kind === "error" ? "error" : `${added.length} signal(s)`;
      process.stderr.write(`corpus-run: ${item.repo}#${item.pr.number} — ${summary}\n`);
      await writeCsv();
    }
  };

  await Promise.all(Array.from({ length: Math.min(options.jobs, queue.length) }, worker));
  await writeCsv();
  return writeFailed;
}

// --- Main ------------------------------------------------------------------------------------------------

function fail(message, code, withUsage = false) {
  process.stderr.write(`corpus-run: ${message}\n${withUsage ? `${USAGE}\n` : ""}`);
  return code;
}

async function main(argv, env) {
  const parsed = parseArgs(argv, env);
  if ("error" in parsed) return fail(parsed.error, 2, true);
  const options = parsed.options;
  if (!existsSync(options.cli)) return fail(`--cli ${options.cli}: file not found`, 2, true);

  let corpus;
  try {
    corpus = loadCorpus(options.corpus);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 1);
  }
  if (options.repo !== undefined && !corpus.some((file) => file.repo === options.repo))
    return fail(`--repo ${options.repo}: no corpus file in ${options.corpus} names it`, 2, true);

  const selected = [];
  for (const file of corpus) {
    if (options.repo !== undefined && file.repo !== options.repo) continue;
    for (const pr of options.limit === undefined ? file.prs : file.prs.slice(0, options.limit))
      selected.push({ repo: file.repo, pr });
  }

  let kept = [];
  if (existsSync(options.out)) {
    try {
      kept = parseCsv(readFileSync(options.out, "utf8"));
    } catch (error) {
      return fail(`${options.out}: ${error instanceof Error ? error.message : String(error)}`, 1);
    }
  }
  const done = new Set(kept.map((row) => `${row.repo}#${row.pr}`));
  const pending = selected.filter(({ repo, pr }) => !done.has(`${repo}#${pr.number}`));

  try {
    mkdirSync(options.cache, { recursive: true });
    mkdirSync(dirname(options.out), { recursive: true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 1);
  }

  const writeFailed = await runCorpus(options, pending, kept);
  if (writeFailed !== null)
    return fail(
      `cannot write ${options.out}: ${writeFailed instanceof Error ? writeFailed.message : String(writeFailed)}`,
      1,
    );
  return 0;
}

function isDirectRun() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  for (const name of ["SIGINT", "SIGTERM"]) {
    process.on(name, () => {
      killAll();
      process.exit(130);
    });
  }
  process.exitCode = await main(process.argv.slice(2), process.env);
}
