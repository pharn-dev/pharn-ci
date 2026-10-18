import {
  type CheckInput,
  type CoverageFileInput,
  check,
  coverageChoiceLine,
  coverageEntryList,
  type DirEntry,
  expandCoverageEntries,
  gitDiffArgs,
  type InputErrorText,
  type PharnConfig,
  parseConfig,
  parseCoverageEntries,
  parseLsTreeSizes,
  type Report,
  readCoverageChunks,
  readDiffChunks,
  renderMarkdown,
  resolveInputs,
  VERSION,
} from "@pharn-ci/core";
import { type PrNumberTarget, parsePrNumberInputs, resolvePrNumberTarget } from "./pr-number.js";

/** Identifies the single sticky comment pharn-ci owns on a PR. */
export const COMMENT_MARKER = "<!-- pharn-ci -->";

/** Start of the second comment line, which names the workflow and job that own the comment. */
const SCOPE_LINE_PREFIX = "<!-- pharn-ci scope:";

/** The login of the default GITHUB_TOKEN: the one author of a pre-scope comment an unknown viewer may claim. */
const DEFAULT_TOKEN_LOGIN = "github-actions[bot]";

/**
 * The scope line of a workflow and job. Both parts are URL-encoded, so neither can close the HTML
 * comment, add a line or contain the "/" separator.
 */
export function commentScopeLine(workflow: string, job: string): string {
  return `${SCOPE_LINE_PREFIX} ${encodeURIComponent(workflow)}/${encodeURIComponent(job)} -->`;
}

export interface IssueComment {
  id: number;
  body?: string | null | undefined;
  user?: { login: string } | null | undefined;
}

/** The slice of the GitHub API the action uses. */
export interface GitHubApi {
  compareDiff(basehead: string): Promise<string>;
  /** Read-only: the base and head commit SHAs of a pull request (PR-number mode). */
  getPullRequest(pullNumber: number): Promise<{ baseSha: string; headSha: string }>;
  /** Read-only: the file paths of a commit's tree, and whether GitHub cut the listing short (PR-number mode). */
  listTree(sha: string): Promise<{ paths: string[]; truncated: boolean }>;
  /**
   * Login the token comments as. `null` when the token cannot read `GET /user` (an App installation
   * token or the default GITHUB_TOKEN): the login is then unknown and comments are matched by scope.
   */
  viewerLogin(): Promise<string | null>;
  listComments(issueNumber: number): Promise<IssueComment[]>;
  /** Resolves the created comment's author login, or null when the response names none. */
  createComment(issueNumber: number, body: string): Promise<string | null>;
  updateComment(commentId: number, body: string): Promise<void>;
  /** Only ever called on a duplicate of pharn-ci's own marker comment (see upsertComment). */
  deleteComment(commentId: number): Promise<void>;
}

export interface ActionContext {
  eventName: string;
  sha: string;
  /** Name of the running workflow (GITHUB_WORKFLOW). */
  workflow?: string;
  /** Id of the running job (GITHUB_JOB). */
  job?: string;
  payload: {
    before?: string;
    pull_request?: { number: number; base: { sha: string }; head: { sha: string } };
    merge_group?: { base_sha: string; head_sha: string };
  };
}

export interface ActionDeps {
  getInput(name: string): string;
  context: ActionContext;
  workspace: string;
  tempDir: string;
  api: GitHubApi;
  git(args: string[]): Promise<string>;
  /**
   * git's stdout as UTF-8 text chunks, without holding it whole. Iteration throws an Error whose message is git's
   * stderr (or says that git timed out) when git fails. Absent: one chunk of what `git` resolves.
   */
  gitStream?(args: string[]): AsyncIterable<string>;
  readFile(path: string): Promise<string | null>;
  /**
   * The file as UTF-8 text chunks, or null when it does not exist; any other failure rejects, or throws during
   * iteration. Absent: one chunk of what `readFile` resolves.
   */
  readFileStream?(path: string): Promise<AsyncIterable<string> | null>;
  /**
   * The entries of a directory, with symbolic links reported as such and never followed; null when the
   * directory does not exist or is not a directory. Only called to expand a coverage glob.
   */
  listDir(path: string): Promise<DirEntry[] | null>;
  writeFile(path: string, text: string): Promise<void>;
  resolvePath(...segments: string[]): string;
  info(message: string): void;
  warning(message: string): void;
  setOutput(name: string, value: string): void;
  setFailed(message: string): void;
  writeSummary(markdown: string): Promise<void>;
}

const ZERO_SHA = /^0+$/;

/** Config file read when the config input is empty. */
const DEFAULT_CONFIG = ".pharn/ci.yml";

/** How the action names its inputs in input errors. */
const INPUT_ERRORS: InputErrorText = {
  coverageFormat: (value) => `coverage-format "${value}" is not supported (supported: lcov, cobertura, auto)`,
  threshold: "threshold",
  coverageFile: "coverage-file",
  exclude: "exclude",
  coverageRoot: "coverage-root",
  noCoverageFile: "no coverage file: set the coverage-file input or coverage.file in .pharn/ci.yml",
};

/** GitHub rejects comments over 65,536 characters; stay below that with room for the note. */
export const MAX_COMMENT_LENGTH = 65_000;
const TRUNCATED_NOTE = "\n\n_Truncated: the full report is in the job summary and report.json._\n";
/** GitHub rejects a step summary over 1 MiB (1,048,576 bytes); stay below that with room for the note. */
export const MAX_SUMMARY_BYTES = 1_000_000;
// The summary cannot point to itself.
const SUMMARY_TRUNCATED_NOTE = "\n\n_Truncated: the full report is in report.json._\n";
/** Table rows to try, most first, when the full render does not fit. 0 is the minimal render. */
const FALLBACK_ROWS = [25, 12, 6, 3, 1, 0];

export async function run(deps: ActionDeps): Promise<Report | undefined> {
  try {
    return await runUnsafe(deps);
  } catch (err) {
    deps.setFailed(`pharn-ci: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/**
 * Renamed Action inputs: old name -> current name. Before 1.0 an input is never removed; a renamed
 * one keeps its old name here, and declared in action.yml, for at least one minor release
 * (docs/RELEASING.md, "Inputs, outputs and message codes"). Empty while no input has been renamed.
 */
export const INPUT_ALIASES: Readonly<Record<string, string>> = Object.freeze({});

/**
 * The trimmed value of an input, falling back to any old name it was renamed from. An old name
 * still works but warns; when both are set, the current name wins and the old one is ignored.
 */
export function readInput(
  deps: Pick<ActionDeps, "getInput" | "warning">,
  name: string,
  aliases: Readonly<Record<string, string>> = INPUT_ALIASES,
): string {
  const value = deps.getInput(name).trim();
  for (const [oldName, current] of Object.entries(aliases)) {
    if (current !== name) continue;
    const oldValue = deps.getInput(oldName).trim();
    if (oldValue === "") continue;
    if (value !== "") {
      deps.warning(`input "${oldName}" is deprecated and ignored because "${name}" is also set; remove "${oldName}"`);
      continue;
    }
    deps.warning(`input "${oldName}" is deprecated; rename it to "${name}"`);
    return oldValue;
  }
  return value;
}

async function runUnsafe(deps: ActionDeps): Promise<Report> {
  const input = (name: string) => readInput(deps, name);
  // Validated first: in a workflow_run these come from an artifact and are attacker-controlled.
  const { prNumber, headSha } = parsePrNumberInputs(input("pr-number"), input("head-sha"));
  const pr = deps.context.payload.pull_request;
  if (pr && prNumber !== undefined && prNumber !== pr.number) {
    throw new Error(`pr-number ${prNumber} is not the pull request of this event (#${pr.number})`);
  }
  const config = await loadConfig(input("config") || undefined, deps);

  // An empty input is not given: the config, then the default, applies.
  const resolved = resolveInputs(
    config,
    {
      coverageFile: splitLines(input("coverage-file")),
      coverageFormat: input("coverage-format") || undefined,
      threshold: input("threshold") || undefined,
      exclude: splitPatternList(input("exclude")),
      coverageRoot: input("coverage-root") || undefined,
      requireAgentSetup: parseBool(input("require-agent-setup"), "require-agent-setup"),
    },
    INPUT_ERRORS,
  );
  if (!resolved.ok) throw resolved.errors[0];
  const { coverageFormat: format, threshold, exclude, coverageRoot, requireAgentSetup } = resolved.inputs;
  const failOnThreshold = parseBool(input("fail-on-threshold"), "fail-on-threshold") ?? true;
  const comment = parseBool(input("comment"), "comment") ?? true;

  // PR-number mode: no pull_request payload, the pr-number input names the PR. Resolved before anything is read or
  // measured, so a stale or forged target fails first.
  const target = !pr && prNumber !== undefined ? await resolvePrNumberTarget(deps, { prNumber, headSha }) : undefined;

  // Entries are relative to the workspace, from the input and from the config alike.
  const coverageLabel = resolved.inputs.coverageFile.fromConfig ? '"coverage.file"' : "coverage-file";
  const entries = parseCoverageEntries(coverageEntryList(resolved.inputs.coverageFile.path), coverageLabel);
  const expanded = await expandCoverageEntries(
    entries,
    (dir) => deps.listDir(deps.resolvePath(deps.workspace, dir)),
    coverageLabel,
  );
  // Every entry is resolved and every file read before the check; a file reached twice is read once.
  const coverageFiles: CoverageFileInput[] = [];
  const seen = new Set<string>();
  for (const item of expanded) {
    if (item.kind === "no-match") {
      coverageFiles.push({ missingFile: item.glob });
      continue;
    }
    const name = item.kind === "literal" ? item.entry : item.path;
    const coveragePath = deps.resolvePath(deps.workspace, name);
    if (seen.has(coveragePath)) continue;
    seen.add(coveragePath);
    const chunks = await openFile(deps, coveragePath);
    if (chunks === null) {
      coverageFiles.push({ missingFile: name });
      continue;
    }
    // The file is parsed as it is read, with the same repo root and coverage root the check would use.
    const { choice, parsed } = await readCoverageChunks(chunks, format, {
      repoRoot: deps.workspace,
      ...(coverageRoot === undefined ? {} : { coverageRoot }),
    });
    deps.info(coverageChoiceLine(choice));
    coverageFiles.push({ parsed, format: choice.format, file: name });
  }

  const repoFiles = await trackedFiles(target, deps);
  // File sizes in HEAD, so an empty agent setup file can be reported. Optional: without them the check still runs.
  // PR-number mode skips them: the checkout is not the PR, so its HEAD sizes would describe other files.
  const lsTree = target
    ? null
    : await deps.git(["ls-tree", "-r", "-l", "-z", "--full-tree", "HEAD"]).catch((err: unknown) => {
        deps.warning(`git ls-tree failed, so empty agent setup files are not reported: ${String(err)}`);
        return null;
      });

  const checkInput: CheckInput = {
    version: VERSION,
    coverage: { files: coverageFiles, format },
    diff: await getDiff(input("base-ref"), deps, target),
    repoRoot: deps.workspace,
    threshold,
    repoFiles,
    ...(lsTree === null ? {} : { repoFileBytes: parseLsTreeSizes(lsTree) }),
    exclude,
    requireAgentSetup,
    ...(coverageRoot === undefined ? {} : { coverageRoot }),
    ...(input("config") === "" ? {} : { configPath: input("config") }),
  };
  const report = check(checkInput);
  const summary = fitMarkdown(report, {
    prefix: "",
    note: SUMMARY_TRUNCATED_NOTE,
    fits: (text) => utf8Bytes(text) <= MAX_SUMMARY_BYTES,
  });

  const reportPath = deps.resolvePath(deps.tempDir, "pharn-ci", "report.json");
  await deps.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  deps.setOutput("report-path", reportPath);
  deps.setOutput("verdict", report.verdict);
  deps.setOutput("diff-coverage", report.diffCoverage?.percent?.toString() ?? "");

  await deps.writeSummary(summary).catch((err: unknown) => deps.warning(`could not write job summary: ${String(err)}`));

  const issueNumber = pr?.number ?? target?.number;
  if (comment && issueNumber !== undefined) {
    const scopeLine = commentScopeLine(deps.context.workflow ?? "", deps.context.job ?? "");
    const body = fitMarkdown(report, {
      prefix: `${COMMENT_MARKER}\n${scopeLine}\n`,
      note: TRUNCATED_NOTE,
      fits: (text) => text.length <= MAX_COMMENT_LENGTH,
    });
    await upsertComment(deps, issueNumber, body, scopeLine);
  }

  deps.info(`pharn-ci verdict: ${report.verdict}`);
  if (report.verdict === "fail" && failOnThreshold) {
    const errors = report.messages.filter((m) => m.level === "error").map((m) => m.text);
    deps.setFailed(`pharn-ci: ${errors.join(" ")}`);
  }
  return report;
}

/**
 * The repo's file paths. Normally `git ls-files` of the checkout; in PR-number mode the checkout is not the PR, so
 * the paths come from the git tree of the PR head, through the GitHub API.
 */
async function trackedFiles(target: PrNumberTarget | undefined, deps: ActionDeps): Promise<string[]> {
  if (!target) {
    const out = await deps.git(["ls-files", "-z"]).catch((err: unknown) => {
      deps.warning(`git ls-files failed, agent setup scan skipped: ${String(err)}`);
      return "";
    });
    return out.split("\0").filter((p) => p !== "");
  }
  try {
    const tree = await deps.api.listTree(target.headSha);
    if (tree.truncated) {
      deps.warning(
        "the file list of the PR head is truncated by the GitHub API (very large repository); " +
          "the agent setup scan may miss files",
      );
    }
    return tree.paths;
  } catch (err) {
    deps.warning(
      `could not list the files of the PR head through the GitHub API, agent setup scan skipped: ${String(err)}`,
    );
    return [];
  }
}

/** One chunk: what a whole-text read gave. */
async function* oneChunk(read: () => Promise<string>): AsyncGenerator<string> {
  yield await read();
}

/** git's stdout as chunks: streamed when the deps can, else the whole text as a single chunk. */
function streamGit(deps: ActionDeps, args: string[]): AsyncIterable<string> {
  return deps.gitStream ? deps.gitStream(args) : oneChunk(() => deps.git(args));
}

/** The file as chunks: streamed when the deps can, else the whole text as a single chunk; null when it does not exist. */
async function openFile(deps: ActionDeps, path: string): Promise<AsyncIterable<string> | null> {
  if (deps.readFileStream) return deps.readFileStream(path);
  const text = await deps.readFile(path);
  return text === null ? null : oneChunk(async () => text);
}

/** Diff of the change under test: base...HEAD, from local git if possible, else the GitHub API. */
async function getDiff(baseRefInput: string, deps: ActionDeps, target?: PrNumberTarget): Promise<CheckInput["diff"]> {
  // A leading "-" would reach git as an option (e.g. --output=<file>), not a revision.
  if (baseRefInput.startsWith("-")) throw new Error(`base-ref "${baseRefInput}" must not start with "-"`);
  // PR-number mode: the checkout is not the PR, so only the GitHub API can give the diff.
  if (target) return getTargetDiff(baseRefInput, target, deps);
  const { context } = deps;
  const pr = context.payload.pull_request;
  const mergeGroup = context.payload.merge_group;
  const base =
    baseRefInput ||
    pr?.base.sha ||
    mergeGroup?.base_sha ||
    (context.payload.before && !ZERO_SHA.test(context.payload.before) ? context.payload.before : "");
  if (!base) return { unavailable: "no base to diff against (not a pull request; set the base-ref input)" };

  // pull_request checks out the merge commit (context.sha); pull_request_target checks out the base;
  // merge_group checks out the merge queue's temporary commit (merge_group.head_sha).
  const head = context.eventName === "pull_request_target" && pr ? pr.head.sha : mergeGroup?.head_sha || context.sha;

  // On pull_request_target the default checkout is the base branch, so a local base...HEAD diff is
  // empty and would pass as NO_COVERABLE_CHANGES while measuring nothing of the PR.
  if (context.eventName === "pull_request_target" && pr) {
    const localHead = await deps.git(["rev-parse", "HEAD"]).then(
      (out) => out.trim(),
      () => null,
    );
    if (localHead !== null && localHead !== pr.head.sha) {
      // Never advise checking out the PR head here: that runs fork code with a write token.
      return {
        unavailable:
          "pull_request_target cannot be measured safely: run pharn-ci on pull_request " +
          "(fork PRs get the job summary only); see SECURITY.md",
      };
    }
  }

  const localBase = await resolveLocal(base, deps);
  if (localBase) {
    try {
      return { parsed: await readDiffChunks(streamGit(deps, gitDiffArgs(localBase))) };
    } catch (err) {
      deps.info(`local git diff failed, falling back to the GitHub API: ${String(err)}`);
    }
  }
  try {
    return { text: await deps.api.compareDiff(`${base}...${head}`) };
  } catch (err) {
    // An explicit base-ref found neither locally nor by the API is most likely a typo: fail the
    // step like the CLI does, instead of reporting DIFF_UNAVAILABLE (a warning without a threshold).
    if (baseRefInput && !localBase) {
      throw new Error(
        `base-ref "${baseRefInput}" was not found in the checkout or through the GitHub API (${String(err)}); ` +
          "check the ref name, or use actions/checkout with fetch-depth: 0",
      );
    }
    deps.warning(`could not fetch the diff from the GitHub API: ${String(err)}`);
    return { unavailable: `could not get the diff for ${base}...${head} (use actions/checkout with fetch-depth: 0)` };
  }
}

/** PR-number mode: base...head from the compare API only; no local git. An explicit base-ref replaces the PR base. */
async function getTargetDiff(
  baseRefInput: string,
  target: PrNumberTarget,
  deps: ActionDeps,
): Promise<CheckInput["diff"]> {
  const base = baseRefInput || target.baseSha;
  try {
    return { text: await deps.api.compareDiff(`${base}...${target.headSha}`) };
  } catch (err) {
    if (baseRefInput) {
      throw new Error(
        `base-ref "${baseRefInput}" was not found through the GitHub API (${String(err)}); check the ref name`,
      );
    }
    deps.warning(`could not fetch the diff from the GitHub API: ${String(err)}`);
    return { unavailable: `could not get the diff for ${base}...${target.headSha} from the GitHub API` };
  }
}

async function resolveLocal(base: string, deps: ActionDeps): Promise<string | null> {
  const candidates = /^[0-9a-f]{40}$/i.test(base) ? [base] : [`origin/${base}`, base];
  for (const ref of candidates) {
    try {
      await deps.git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
      return ref;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const utf8Bytes = (text: string): number => Buffer.byteLength(text, "utf8");

/**
 * Render the report so that it fits a size limit. A report that fits is returned as `renderMarkdown`
 * makes it. Otherwise the tables are re-rendered with fewer rows until it fits, so the verdict and the
 * messages (which the renderer puts before the inventory) stay; `note` is appended to say rows are
 * missing. Only when the messages alone are too long is the text cut, at a line break.
 */
export function fitMarkdown(
  report: Report,
  fit: { prefix: string; note: string; fits(text: string): boolean },
): string {
  const full = fit.prefix + renderMarkdown(report);
  if (fit.fits(full)) return full;

  let minimal = "";
  for (const maxRows of FALLBACK_ROWS) {
    minimal = fit.prefix + renderMarkdown(report, { maxRows });
    const text = minimal + fit.note;
    if (fit.fits(text)) return text;
  }

  // Last resort: the longest prefix of the minimal render that fits with the note.
  const fitsAt = (length: number) => fit.fits(minimal.slice(0, length) + fit.note);
  let low = 0;
  let high = minimal.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fitsAt(mid)) low = mid;
    else high = mid - 1;
  }
  const lineBreak = minimal.lastIndexOf("\n", low);
  let end = lineBreak > fit.prefix.length ? lineBreak : low;
  // Do not leave half of a surrogate pair at the cut.
  if (end === low && end > 0 && /[\uD800-\uDBFF]/.test(minimal.charAt(end - 1))) end--;
  return minimal.slice(0, end) + fit.note;
}

/**
 * Create or update the one comment carrying COMMENT_MARKER for this scope: the oldest (lowest id)
 * own marker comment (see ownComments). Concurrent runs on one PR can each find none and create
 * one, so after creating, the comments are listed again and newer duplicates are deleted. A
 * duplicate must share the kept comment's author login and scope. Clean-up failures are only
 * warnings.
 */
export async function upsertComment(
  deps: Pick<ActionDeps, "api" | "info" | "warning">,
  issueNumber: number,
  body: string,
  scopeLine: string,
) {
  try {
    const [comments, viewer] = await Promise.all([deps.api.listComments(issueNumber), deps.api.viewerLogin()]);
    const [existing, ...rest] = ownComments(comments, viewer, scopeLine);
    if (existing) {
      await deps.api.updateComment(existing.id, body);
      deps.info(`updated pharn-ci comment ${existing.id}`);
      // With an unknown viewer, own comments may come from different bots: only the kept one's login is touched.
      const scope = commentScope(existing, scopeLine);
      await deleteDuplicates(
        deps,
        rest.filter((c) => c.user?.login === existing.user?.login && commentScope(c, scopeLine) === scope),
      );
      return;
    }
    // A response without an author leaves the viewer; with neither, the clean-up cannot tell its comment apart.
    const createdLogin = (await deps.api.createComment(issueNumber, body)) ?? viewer;
    deps.info("created pharn-ci comment");
    if (createdLogin !== null) await removeRaceDuplicates(deps, issueNumber, createdLogin, body, scopeLine);
  } catch (err) {
    // Typical cause: PRs from forks get a read-only token.
    deps.warning(
      `could not post the PR comment (${errorText(err)}); ` +
        "the report is in the job summary. Grant `pull-requests: write` to enable comments.",
    );
  }
}

/**
 * How a marker comment relates to this run's scope line, read from the comment's second line:
 * "same" when it equals the scope line, "other" when it is any other scope line (compared as exact
 * text after dropping a CRLF line ending, so a malformed one is "other"), "legacy" when it is not a
 * scope line (a comment from before scopes) or the comment has no second line.
 */
function commentScope(comment: IssueComment, scopeLine: string): "same" | "other" | "legacy" {
  // A body edited in GitHub's web editor comes back with CRLF line endings.
  const second = (comment.body ?? "").split("\n")[1]?.replace(/\r$/, "");
  if (second === scopeLine) return "same";
  return second?.startsWith(SCOPE_LINE_PREFIX) ? "other" : "legacy";
}

/**
 * Anyone can post a comment containing the marker; only some are pharn-ci's, oldest first. A
 * comment of another scope never is. With a known viewer, it is the viewer's own comment of this
 * scope or from before scopes. With an unknown viewer (no readable `GET /user`), it is a bot's
 * comment of this scope (a login ending in `[bot]`, which GitHub does not allow in a user login),
 * or a pre-scope comment of the default GITHUB_TOKEN.
 */
function ownComments(comments: IssueComment[], viewer: string | null, scopeLine: string): IssueComment[] {
  return comments
    .filter((c) => {
      if (!c.body?.startsWith(COMMENT_MARKER)) return false;
      const login = c.user?.login;
      const scope = commentScope(c, scopeLine);
      if (login === undefined || scope === "other") return false;
      if (viewer !== null) return login === viewer;
      return scope === "same" ? login.endsWith("[bot]") : login === DEFAULT_TOKEN_LOGIN;
    })
    .sort((a, b) => a.id - b.id);
}

/**
 * After a create: keep the oldest marker comment of the created comment's login and this scope,
 * carrying this run's report, and delete the rest. Comments from before scopes are left alone.
 */
async function removeRaceDuplicates(
  deps: Pick<ActionDeps, "api" | "info" | "warning">,
  issueNumber: number,
  createdLogin: string,
  body: string,
  scopeLine: string,
) {
  try {
    const [keep, ...duplicates] = (await deps.api.listComments(issueNumber))
      .filter(
        (c) =>
          c.body?.startsWith(COMMENT_MARKER) && c.user?.login === createdLogin && commentScope(c, scopeLine) === "same",
      )
      .sort((a, b) => a.id - b.id);
    if (!keep || duplicates.length === 0) return;
    await deleteDuplicates(deps, duplicates);
    // This run's comment may have been one of the deleted duplicates.
    if (keep.body !== body) {
      await deps.api.updateComment(keep.id, body);
      deps.info(`updated pharn-ci comment ${keep.id}`);
    }
  } catch (err) {
    deps.warning(`could not remove duplicate pharn-ci comments: ${errorText(err)}`);
  }
}

/** Callers pass only own marker comments with the kept comment's author login and scope. */
async function deleteDuplicates(deps: Pick<ActionDeps, "api" | "info" | "warning">, duplicates: IssueComment[]) {
  for (const dup of duplicates) {
    try {
      await deps.api.deleteComment(dup.id);
      deps.info(`deleted duplicate pharn-ci comment ${dup.id}`);
    } catch (err) {
      deps.warning(`could not delete duplicate pharn-ci comment ${dup.id}: ${errorText(err)}`);
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The config input, or `.pharn/ci.yml` when it is empty. A missing default file is no config; a
 * missing file the input names fails the step (like the CLI's --config), so a typo cannot drop a
 * threshold held only in the config.
 */
async function loadConfig(explicit: string | undefined, deps: ActionDeps): Promise<PharnConfig> {
  const path = explicit ?? DEFAULT_CONFIG;
  const text = await deps.readFile(deps.resolvePath(deps.workspace, path));
  if (text === null) {
    if (explicit !== undefined) throw new Error(`config file not found: ${path}`);
    return {};
  }
  try {
    return parseConfig(text);
  } catch (err) {
    throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Entries of a list input separated by commas or newlines; surrounding spaces and blank entries are dropped. */
function splitPatternList(value: string): string[] {
  return value
    .split(",")
    .flatMap((part) => part.split("\n"))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * Entries of a list input, one per line (commas are part of a path); surrounding spaces and blank lines are
 * dropped. One entry is that string, several are a list, none is not given (undefined).
 */
function splitLines(value: string): string | string[] | undefined {
  const entries = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return entries.length > 1 ? entries : entries[0];
}

/** An empty input is not given (undefined). */
function parseBool(value: string, name: string): boolean | undefined {
  if (value === "") return undefined;
  if (/^(true|yes|on|1)$/i.test(value)) return true;
  if (/^(false|no|off|0)$/i.test(value)) return false;
  throw new Error(`${name} must be true or false, got "${value}"`);
}
