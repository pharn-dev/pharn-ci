// Measures how often PRs written by AI coding agents delete, skip, narrow or weaken tests.
// A one-off research script for docs/PRECISION.md, never shipped with the Action. It calls only the
// GitHub REST API, with the token in GH_TOKEN or GITHUB_TOKEN (e.g. GH_TOKEN=$(gh auth token)).
//
//   node scripts/agent-pr-baserate.mjs [--state merged|unmerged] [--per-bot 500] [--per-repo 3]
//                                      [--limit N] [--until YYYY-MM-DD] [--out .cache/baserate]
//
// --state merged (the default) samples merged PRs; unmerged samples PRs closed without merging,
// which is where a tampering attempt a reviewer caught ends up. Use a separate --out for each.
// It samples public PRs per agent app, newest first, with at most --per-repo PRs per repository
// so a few busy repositories do not dominate. Search results, the sample and every diff are cached in
// --out, so a run resumes where it stopped and a re-run reads the same sample. The detectors are plain
// regexes over the diff text: a deliberate approximation of TI01, TI03, TI04 and TI10 from the product
// spec, not the Action's implementation. Output: <out>/hits.csv (one row per finding, with a short
// excerpt for hand review) and <out>/summary.json (PRs scanned and PRs hit, per bot and signal).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BOTS = ["claude", "copilot-swe-agent", "devin-ai-integration", "cursor"];
// Test runners' own repositories are full of intentional .skip/.only fixtures; pharn-dev is us.
const EXCLUDED_ORGS = ["vitest-dev", "jestjs", "jest-community", "mochajs", "pytest-dev", "pharn-dev"];
const API = "https://api.github.com";
const SEARCH_PAUSE_MS = 2200; // search allows 30 requests a minute
const MAX_DIFF_BYTES = 10 * 1024 * 1024;

function parseArgs(argv) {
  const options = { state: "merged", perBot: 500, perRepo: 3, limit: Infinity, until: null, out: ".cache/baserate" };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) usage(`missing value for ${flag}`);
    if (flag === "--state") {
      if (value !== "merged" && value !== "unmerged") usage("--state is merged or unmerged");
      options.state = value;
    } else if (flag === "--per-bot") options.perBot = positiveInt(flag, value);
    else if (flag === "--per-repo") options.perRepo = positiveInt(flag, value);
    else if (flag === "--limit") options.limit = positiveInt(flag, value);
    else if (flag === "--until") options.until = isoDate(value);
    else if (flag === "--out") options.out = value;
    else usage(`unknown option ${flag}`);
  }
  if (options.until === null) options.until = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return options;
}

function positiveInt(flag, value) {
  if (!/^[1-9]\d*$/.test(value)) usage(`${flag} needs a positive integer`);
  return Number(value);
}

function isoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) usage("--until needs YYYY-MM-DD");
  return value;
}

function usage(message) {
  process.stderr.write(`agent-pr-baserate: ${message}\n`);
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A cached file's text, or null when it is not there yet. Read directly instead of checking first,
// so nothing can change between the check and the read.
function readCached(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

// Creates the cache file; never overwrites one that appeared meanwhile (another run got there first).
function writeCached(path, text) {
  try {
    writeFileSync(path, text, { flag: "wx" });
  } catch (error) {
    if (!(error && error.code === "EEXIST")) throw error;
  }
}

// `owner/name` as GitHub allows it, and a PR number. Cache file names and API paths are built from
// these, so anything else (from the API or from an edited sample.json) is skipped.
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const validPr = (pr) =>
  typeof pr?.repo === "string" &&
  REPO.test(pr.repo) &&
  !/^\.+$/.test(pr.repo.split("/")[1]) && // `.github` is a real name; `.` and `..` are not
  Number.isInteger(pr.number) &&
  pr.number > 0;

async function github(token, path, accept = "application/vnd.github+json") {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${API}${path}`, {
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
        "User-Agent": "pharn-ci-baserate",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (response.ok) return response;
    const limited =
      response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
    if ((limited || response.status >= 500) && attempt < 6) {
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      const retryAfter = Number(response.headers.get("retry-after")) * 1000;
      const wait = retryAfter || (reset ? Math.max(reset - Date.now(), 0) + 1000 : 0) || 2 ** attempt * 1000;
      process.stderr.write(`  ${response.status} on ${path.slice(0, 80)}; waiting ${Math.round(wait / 1000)}s\n`);
      await sleep(Math.min(wait, 15 * 60_000));
      continue;
    }
    return response;
  }
}

// Weekly windows going back from `until`, newest first: search returns at most 1000 results a query.
function* weeks(until) {
  let end = new Date(`${until}T00:00:00Z`);
  for (let i = 0; i < 104; i++) {
    const start = new Date(end.getTime() - 6 * 86_400_000);
    yield [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
    end = new Date(start.getTime() - 86_400_000);
  }
}

async function sampleBot(token, bot, options, cacheDir) {
  const picked = [];
  const perRepo = new Map();
  const excluded = EXCLUDED_ORGS.map((org) => `-org:${org}`).join(" ");
  for (const [from, to] of weeks(options.until)) {
    for (let page = 1; page <= 10 && picked.length < options.perBot; page++) {
      const which =
        options.state === "merged" ? `is:merged merged:${from}..${to}` : `is:closed is:unmerged closed:${from}..${to}`;
      const q = `is:pr ${which} is:public author:app/${bot} ${excluded}`;
      const cacheFile = join(cacheDir, `${bot}_${from}_${page}.json`);
      const cached = readCached(cacheFile);
      let body;
      if (cached !== null) body = JSON.parse(cached);
      else {
        await sleep(SEARCH_PAUSE_MS);
        const params = new URLSearchParams({ q, per_page: "100", page: String(page), sort: "created", order: "desc" });
        const response = await github(token, `/search/issues?${params}`);
        if (!response.ok) throw new Error(`search failed (${response.status}): ${await response.text()}`);
        body = await response.json();
        writeCached(cacheFile, JSON.stringify(body));
      }
      for (const item of body.items) {
        const repo = item.repository_url.replace(`${API}/repos/`, "");
        if (!validPr({ repo, number: item.number })) continue;
        const count = perRepo.get(repo) ?? 0;
        if (count >= options.perRepo) continue;
        perRepo.set(repo, count + 1);
        picked.push({
          bot,
          repo,
          number: item.number,
          url: item.html_url,
          mergedAt: item.pull_request?.merged_at ?? null,
          closedAt: item.closed_at ?? null,
        });
        if (picked.length >= options.perBot) break;
      }
      if (body.items.length < 100) break;
    }
    if (picked.length >= options.perBot) break;
  }
  return picked;
}

// --- diff parsing -------------------------------------------------------------------------------

function parseDiff(text) {
  const files = [];
  let file = null;
  let inHunk = false;
  let newLine = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      file = { oldPath: match?.[1] ?? "", path: match?.[2] ?? "", status: "modified", added: [], removed: [] };
      files.push(file);
      inHunk = false;
    } else if (!file) {
    } else if (!inHunk && line.startsWith("new file mode")) file.status = "added";
    else if (!inHunk && line.startsWith("deleted file mode")) file.status = "deleted";
    else if (!inHunk && line.startsWith("rename from ")) {
      file.status = "renamed";
      file.oldPath = line.slice("rename from ".length);
    } else if (!inHunk && line.startsWith("rename to ")) file.path = line.slice("rename to ".length);
    else if (line.startsWith("@@")) {
      inHunk = true;
      newLine = Number(/\+(\d+)/.exec(line)?.[1] ?? 0);
    } else if (inHunk && line.startsWith("+")) file.added.push({ line: newLine++, text: line.slice(1) });
    else if (inHunk && line.startsWith("-")) file.removed.push(line.slice(1));
    else if (inHunk && line.startsWith(" ")) newLine++;
  }
  return files;
}

// --- detectors ----------------------------------------------------------------------------------

// Test-file globs from TEST-INTEGRITY-SPEC "Test-file detection", limited to test code (a data file
// under test/ is not a test).
const CODE = /\.(?:[cm]?[jt]sx?|py|go)$/;
function isTestFile(path) {
  if (!CODE.test(path)) return false;
  const segments = path.split("/");
  const base = segments.at(-1);
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(base) || /\.(?:e2e|pw)\.ts$/.test(base)) return true;
  if (/^test_.*\.py$/.test(base) || /_test\.py$/.test(base) || /_test\.go$/.test(base)) return true;
  return segments.slice(0, -1).some((s) => s === "test" || s === "tests" || s === "__tests__");
}

const SKIP = [
  /\b(?:it|test|describe|suite|context|bench)\.skip\b/,
  /\b(?:xit|xtest|xdescribe|xcontext)\s*\(/,
  /\b(?:it|test)\.todo\b/,
  /\b(?:it|test|describe)\.(?:skipIf|runIf)\s*\(\s*(?:true|false|0|1)\s*\)/,
  /\b(?:it|test)\.fails\b/,
  /@pytest\.mark\.(?:skip|skipif|xfail)\b/,
  /\bpytest\.skip\s*\(/,
  /@unittest\.skip/,
  /\bt\.Skip(?:f|Now)?\s*\(/,
];
// `fit(` only as a bare call: `solver.fit(` (scikit-learn style) is not a focused test.
const ONLY = [/\b(?:it|test|describe|suite|context)\.only\b/, /(?<![.\w$])(?:fit|fdescribe|ftest)\s*\(/];
const WEAKENED_SCRIPT = [
  /\|\|\s*true\b/,
  /\bexit 0\b/,
  /--passWithNoTests\b/,
  /--testPathPattern\b/,
  /--testNamePattern\b/,
  /(?:^|\s)-t\s/,
  /^\s*echo\b/,
];
const COMMENT = /^\s*(?:\/\/|#|\*|\/\*)/;

// What makes a matching line the same skip as before: the token that matched and the test's name (its
// first string literal), or the whole line when it has no name. So a skip that was already there does
// not count when the PR only moves the line or edits the rest of it (`() =>` to `async () =>`).
function skipKey(text, patterns) {
  const pattern = patterns.find((p) => p.test(text));
  if (!pattern) return null;
  const name = /(["'`])((?:\\.|(?!\1).)*)\1/.exec(text)?.[2];
  return `${pattern.exec(text)[0]}|${name ?? text.trim()}`;
}

// Lines added that match, unless the same skip was removed from the file (moved or edited, not added).
function addedMatches(file, patterns) {
  const removed = new Map();
  for (const text of file.removed) {
    const key = skipKey(text, patterns);
    if (key !== null) removed.set(key, (removed.get(key) ?? 0) + 1);
  }
  const hits = [];
  for (const { line, text } of file.added) {
    if (COMMENT.test(text)) continue;
    const key = skipKey(text, patterns);
    if (key === null) continue;
    const left = removed.get(key) ?? 0;
    if (left > 0) removed.set(key, left - 1);
    else hits.push({ line, text: text.trim() });
  }
  return hits;
}

function scriptEntries(lines) {
  const entries = new Map();
  for (const text of lines) {
    const match = /^\s*"((?:pre|post)?test[\w:.-]*)"\s*:\s*"(.*)"\s*,?\s*$/.exec(text);
    if (match) entries.set(match[1], match[2]);
  }
  return entries;
}

function detect(files) {
  const hits = [];
  for (const file of files) {
    if (file.status === "deleted" && isTestFile(file.path))
      hits.push({ signal: "TI01", path: file.path, line: null, text: "test file deleted" });
    if (file.status === "renamed" && isTestFile(file.oldPath) && !isTestFile(file.path))
      hits.push({ signal: "TI01", path: file.oldPath, line: null, text: `renamed to ${file.path}` });
    if (isTestFile(file.path) && file.status !== "deleted") {
      for (const hit of addedMatches(file, SKIP)) hits.push({ signal: "TI03", path: file.path, ...hit });
      // `.only`/`fit(` are JS test-runner API; in Python `def fit(` is just a method.
      if (/\.[cm]?[jt]sx?$/.test(file.path))
        for (const hit of addedMatches(file, ONLY)) hits.push({ signal: "TI04", path: file.path, ...hit });
    }
    if (/(?:^|\/)package\.json$/.test(file.path) && file.status === "modified") {
      const before = scriptEntries(file.removed);
      const after = scriptEntries(file.added.map((a) => a.text));
      for (const [name, value] of after) {
        const old = before.get(name);
        const weakened = WEAKENED_SCRIPT.some((p) => p.test(value) && !(old !== undefined && p.test(old)));
        if (weakened && !name.startsWith("pre") && !name.startsWith("post"))
          hits.push({ signal: "TI10", path: file.path, line: null, text: `"${name}": "${value}"` });
      }
      for (const name of before.keys())
        if (/^(?:pre|post)test$/.test(name) && !after.has(name))
          hits.push({ signal: "TI10", path: file.path, line: null, text: `"${name}" removed` });
    }
  }
  return hits;
}

// --- main ---------------------------------------------------------------------------------------

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) usage("set GH_TOKEN (for example GH_TOKEN=$(gh auth token))");
  const searchDir = join(options.out, "search");
  const diffDir = join(options.out, "diffs");
  mkdirSync(searchDir, { recursive: true });
  mkdirSync(diffDir, { recursive: true });

  const sampleFile = join(options.out, "sample.json");
  const cachedSample = readCached(sampleFile);
  let sample;
  if (cachedSample !== null) {
    sample = JSON.parse(cachedSample);
    if ((sample.state ?? "merged") !== options.state)
      usage(`${sampleFile} holds a ${sample.state ?? "merged"} sample; use another --out for --state ${options.state}`);
  } else {
    sample = [];
    for (const bot of BOTS) {
      process.stderr.write(`sampling ${bot}\n`);
      sample.push(...(await sampleBot(token, bot, options, searchDir)));
    }
    writeCached(
      sampleFile,
      `${JSON.stringify({ state: options.state, until: options.until, perRepo: options.perRepo, prs: sample }, null, 1)}\n`,
    );
    sample = { prs: sample };
  }
  const prs = sample.prs.filter(validPr).slice(0, options.limit);

  const rows = [];
  const scanned = new Map();
  const hitPrs = new Map();
  let skipped = 0;
  for (const [index, pr] of prs.entries()) {
    const diffFile = join(diffDir, `${pr.repo.replace("/", "__")}__${pr.number}.diff`);
    let text = readCached(diffFile);
    if (text === null) {
      const response = await github(token, `/repos/${pr.repo}/pulls/${pr.number}`, "application/vnd.github.diff");
      text = response.ok ? await response.text() : "";
      if (!response.ok || text.length > MAX_DIFF_BYTES) text = "";
      writeCached(diffFile, text);
    }
    if ((index + 1) % 100 === 0) process.stderr.write(`  ${index + 1}/${prs.length} diffs\n`);
    if (text === "") {
      skipped++;
      continue;
    }
    scanned.set(pr.bot, (scanned.get(pr.bot) ?? 0) + 1);
    const hits = detect(parseDiff(text));
    for (const signal of new Set(hits.map((h) => h.signal))) {
      const key = `${pr.bot}\t${signal}`;
      hitPrs.set(key, (hitPrs.get(key) ?? 0) + 1);
    }
    if (hits.length > 0) hitPrs.set(`${pr.bot}\tany`, (hitPrs.get(`${pr.bot}\tany`) ?? 0) + 1);
    for (const hit of hits)
      rows.push([
        pr.bot,
        pr.repo,
        pr.number,
        pr.url,
        options.state === "merged" ? pr.mergedAt : pr.closedAt,
        hit.signal,
        hit.path,
        hit.line,
        hit.text.slice(0, 120),
      ]);
  }

  const header = [
    "bot",
    "repo",
    "pr",
    "url",
    `${options.state === "merged" ? "merged" : "closed"}_at`,
    "signal",
    "path",
    "line",
    "excerpt",
  ];
  writeFileSync(
    join(options.out, "hits.csv"),
    `${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n")}\n`,
  );

  const signals = ["TI01", "TI03", "TI04", "TI10", "any"];
  const byBot = {};
  for (const bot of BOTS) {
    const n = scanned.get(bot) ?? 0;
    byBot[bot] = { scanned: n };
    for (const s of signals) byBot[bot][s] = hitPrs.get(`${bot}\t${s}`) ?? 0;
  }
  const total = { scanned: [...scanned.values()].reduce((a, b) => a + b, 0) };
  for (const s of signals) total[s] = BOTS.reduce((sum, bot) => sum + byBot[bot][s], 0);
  const summary = { state: options.state, until: options.until, sampled: prs.length, skipped, total, byBot };
  writeFileSync(join(options.out, "summary.json"), `${JSON.stringify(summary, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 1)}\n`);
}

main().catch((error) => {
  process.stderr.write(`agent-pr-baserate: ${error.message}\n`);
  process.exit(2);
});
