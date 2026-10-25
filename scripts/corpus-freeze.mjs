// Freezes the precision corpus: the 200 newest qualifying merged PRs of one public repository before a fixed instant.
// A dev-only maintainer script, never part of the Action or the CLI; nothing the Action bundles imports it. It reaches
// GitHub only through `gh api` (authenticated with `gh auth login`) and uses Node built-ins only.
//
//   node scripts/corpus-freeze.mjs --repo owner/name --frozen-at 2026-10-25T00:00:00Z --count 200
//                                  --out fixtures/corpus/owner__name.json --monorepo true|false
//
// Freeze rule: every PR into the repository's default branch with a merge time strictly before --frozen-at is a
// candidate. Candidates are ordered by merge time, newest first, ties by PR number, highest first; the first --count
// qualifying ones are kept. A bot author or a changesets release PR does not qualify. The bot test runs first, so a
// bot's release PR counts once, under bots. The document stores each kept PR's number, merge time and three shas, and
// how many bot and release PRs were left out between the oldest kept merge time and the freeze instant. Titles and
// logins are read only to apply the rule and are never written. Nothing is written unless everything succeeded.
//
// Safe early stop: the list is paged by last update, newest first. A PR's merge time is never later than its last
// update, so once a page's last PR was updated strictly before the --count-th newest kept merge time, no later page
// can hold a PR that belongs in the window or in the exclusion counts.
//
// Exit codes: 0 written, 1 GitHub or data error (no file written), 2 usage error (before any GitHub call).
import { execFileSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const USAGE =
  "usage: node scripts/corpus-freeze.mjs --repo owner/name --frozen-at <ISO 8601 UTC> --count <n> --out <file> --monorepo true|false";

const MAX_BUFFER = 64 * 1024 * 1024;

// A Bot-type author, a `[bot]` login, or a renovate/dependabot login (any case, any suffix).
export function isBot(pull) {
  const user = pull?.user;
  if (!user) return false;
  if (user.type === "Bot") return true;
  const login = user.login;
  if (typeof login !== "string") return false;
  if (login.endsWith("[bot]")) return true;
  const lower = login.toLowerCase();
  return lower.startsWith("renovate") || lower.startsWith("dependabot");
}

// A changesets release branch, or a whole title of "version packages" after an optional conventional-commit prefix.
export function isRelease(pull) {
  const ref = pull?.head?.ref;
  if (typeof ref === "string" && ref.startsWith("changeset-release/")) return true;
  const title = pull?.title;
  if (typeof title !== "string") return false;
  return /^(?:[a-z]+(?:\([^)]*\))?!?:\s*)?version packages$/.test(title.trim().toLowerCase());
}

// Pure flag parsing: { options } or { error }. No exit here, so tests can call it.
export function parseArgs(argv) {
  const values = new Map();
  const known = ["--repo", "--frozen-at", "--count", "--out", "--monorepo"];
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!known.includes(flag)) return { error: `unknown option ${flag}` };
    const value = argv[i + 1];
    if (value === undefined) return { error: `missing value for ${flag}` };
    values.set(flag, value);
  }
  for (const flag of known) if (!values.has(flag)) return { error: `missing ${flag}` };

  const repo = values.get("--repo");
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) return { error: `--repo needs owner/name, got ${repo}` };

  const frozenAt = values.get("--frozen-at");
  const frozenError = `--frozen-at needs an ISO 8601 UTC timestamp like 2026-10-25T00:00:00Z, got ${frozenAt}`;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(frozenAt)) return { error: frozenError };
  const parsed = new Date(frozenAt);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().replace(".000Z", "Z") !== frozenAt)
    return { error: frozenError };

  const countText = values.get("--count");
  if (!/^[1-9]\d*$/.test(countText)) return { error: `--count needs a positive integer, got ${countText}` };

  const out = values.get("--out");
  if (out === "") return { error: "--out needs a file path" };

  const monorepo = values.get("--monorepo");
  if (monorepo !== "true" && monorepo !== "false") return { error: `--monorepo is true or false, got ${monorepo}` };

  return { options: { repo, frozenAt, count: Number(countText), out, monorepo: monorepo === "true" } };
}

// The PRs of a list, de-duplicated by number (the first occurrence wins; paging by update time can repeat a PR).
function uniqueByNumber(pulls) {
  const seen = new Set();
  const unique = [];
  for (const pull of pulls) {
    if (seen.has(pull.number)) continue;
    seen.add(pull.number);
    unique.push(pull);
  }
  return unique;
}

const mergedBefore = (pull, frozenAt) =>
  typeof pull.merged_at === "string" && Date.parse(pull.merged_at) < Date.parse(frozenAt);

// Merge times of the PRs that qualify for the corpus: merged before the freeze, not a bot, not a release.
export function qualifyingMergedAts(pulls, frozenAt) {
  return uniqueByNumber(pulls)
    .filter((pull) => mergedBefore(pull, frozenAt) && !isBot(pull) && !isRelease(pull))
    .map((pull) => pull.merged_at);
}

// True once no later page can change the kept window or the exclusion counts (see the header).
export function shouldStopPaging(count, keptMergedAts, lastUpdatedAt) {
  if (keptMergedAts.length < count) return false;
  const times = keptMergedAts.map((time) => Date.parse(time)).sort((a, b) => b - a);
  return Date.parse(lastUpdatedAt) < times[count - 1];
}

const newestFirst = (a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at) || b.number - a.number;

export function buildDocument(options, pulls) {
  const { repo, defaultBranch, monorepo, frozenAt, count } = options;
  const merged = uniqueByNumber(pulls).filter((pull) => mergedBefore(pull, frozenAt));
  const qualifying = merged.filter((pull) => !isBot(pull) && !isRelease(pull)).sort(newestFirst);
  if (qualifying.length < count)
    throw new Error(`${repo}: only ${qualifying.length} qualifying merged PRs before ${frozenAt}, need ${count}`);
  const kept = qualifying.slice(0, count);

  const oldest = Date.parse(kept[kept.length - 1].merged_at);
  let bots = 0;
  let releases = 0;
  for (const pull of merged) {
    if (Date.parse(pull.merged_at) < oldest) continue;
    if (isBot(pull)) bots++;
    else if (isRelease(pull)) releases++;
  }

  const prs = kept.map((pull) => {
    const baseSha = pull.base?.sha;
    const headSha = pull.head?.sha;
    const mergeCommitSha = pull.merge_commit_sha;
    if (!baseSha || !headSha || !mergeCommitSha)
      throw new Error(`${repo}#${pull.number}: base.sha, head.sha or merge_commit_sha is missing`);
    return { number: pull.number, mergedAt: pull.merged_at, baseSha, headSha, mergeCommitSha };
  });

  return { repo, defaultBranch, monorepo, frozenAt, excluded: { bots, releases }, prs };
}

export function serialize(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

// --- GitHub part: runs only when the file is executed directly ------------------------------------

const gh = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: MAX_BUFFER }));

function freeze(options) {
  const defaultBranch = gh(`repos/${options.repo}`).default_branch;
  if (typeof defaultBranch !== "string" || defaultBranch === "")
    throw new Error(`${options.repo}: GitHub returned no default branch`);

  const collected = [];
  for (let page = 1; ; page++) {
    const query = `state=closed&base=${encodeURIComponent(defaultBranch)}&sort=updated&direction=desc&per_page=100&page=${page}`;
    const batch = gh(`repos/${options.repo}/pulls?${query}`);
    if (!Array.isArray(batch)) throw new Error(`${options.repo}: unexpected pulls response on page ${page}`);
    if (batch.length === 0) break;
    collected.push(...batch);
    const last = batch[batch.length - 1];
    if (shouldStopPaging(options.count, qualifyingMergedAts(collected, options.frozenAt), last.updated_at)) break;
    process.stderr.write(`  ${options.repo}: page ${page}, ${collected.length} PRs\n`);
  }

  const document = buildDocument({ ...options, defaultBranch }, collected);
  writeFileSync(options.out, serialize(document));
  process.stdout.write(
    `${options.repo}: ${document.prs.length} PRs to ${options.out}; excluded ${document.excluded.bots} bots, ${document.excluded.releases} releases\n`,
  );
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
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`corpus-freeze: ${parsed.error}\n${USAGE}\n`);
    process.exit(2);
  }
  try {
    freeze(parsed.options);
  } catch (error) {
    process.stderr.write(`corpus-freeze: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
