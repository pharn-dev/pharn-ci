import {
  type CheckInput,
  check,
  chooseCoverageFormat,
  coverageChoiceLine,
  isCoverageFormatSelection,
  type PharnConfig,
  parseConfig,
  parseExcludePattern,
  parseThreshold,
  type Report,
  renderMarkdown,
  VERSION,
} from "@pharn-ci/core";

/** Identifies the single sticky comment pharn-ci owns on a PR. */
export const COMMENT_MARKER = "<!-- pharn-ci -->";

export interface IssueComment {
  id: number;
  body?: string | null | undefined;
  user?: { login: string } | null | undefined;
}

/** The slice of the GitHub API the action uses. */
export interface GitHubApi {
  compareDiff(basehead: string): Promise<string>;
  /** Login the token comments as, so only pharn-ci's own comment is ever updated. */
  viewerLogin(): Promise<string>;
  listComments(issueNumber: number): Promise<IssueComment[]>;
  createComment(issueNumber: number, body: string): Promise<void>;
  updateComment(commentId: number, body: string): Promise<void>;
  /** Only ever called on a duplicate of pharn-ci's own marker comment (see upsertComment). */
  deleteComment(commentId: number): Promise<void>;
}

export interface ActionContext {
  eventName: string;
  sha: string;
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
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, text: string): Promise<void>;
  resolvePath(...segments: string[]): string;
  info(message: string): void;
  warning(message: string): void;
  setOutput(name: string, value: string): void;
  setFailed(message: string): void;
  writeSummary(markdown: string): Promise<void>;
}

const ZERO_SHA = /^0+$/;

/** GitHub rejects comments over 65,536 characters; stay below that with room for the note. */
export const MAX_COMMENT_LENGTH = 65_000;
const TRUNCATED_NOTE = "\n\n_Truncated: the full report is in the job summary and report.json._\n";

export async function run(deps: ActionDeps): Promise<Report | undefined> {
  try {
    return await runUnsafe(deps);
  } catch (err) {
    deps.setFailed(`pharn-ci: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

async function runUnsafe(deps: ActionDeps): Promise<Report> {
  const input = (name: string) => deps.getInput(name).trim();
  const config = await loadConfig(input("config") || ".pharn/ci.yml", deps);

  const format = input("coverage-format") || config.coverage?.format || "auto";
  if (!isCoverageFormatSelection(format)) {
    throw new Error(`coverage-format "${format}" is not supported (supported: lcov, cobertura, auto)`);
  }
  const thresholdInput = input("threshold");
  const threshold =
    thresholdInput !== "" ? parseThreshold(thresholdInput, "threshold") : (config.coverage?.threshold ?? null);
  const coverageFile = input("coverage-file") || config.coverage?.file;
  if (!coverageFile) throw new Error("no coverage file: set the coverage-file input or coverage.file in .pharn/ci.yml");
  const failOnThreshold = parseBool(input("fail-on-threshold"), true, "fail-on-threshold");
  const requireAgentSetup = parseBool(
    input("require-agent-setup"),
    config.setup?.require ?? false,
    "require-agent-setup",
  );
  const comment = parseBool(input("comment"), true, "comment");
  const excludeInput = splitPatternList(input("exclude")).map((p) => parseExcludePattern(p, "exclude"));

  const coveragePath = deps.resolvePath(deps.workspace, coverageFile);
  const coverageText = await deps.readFile(coveragePath);
  if (coverageText !== null) deps.info(coverageChoiceLine(chooseCoverageFormat(coverageText, format)));
  const pr = deps.context.payload.pull_request;

  const lsFiles = await deps.git(["ls-files", "-z"]).catch((err: unknown) => {
    deps.warning(`git ls-files failed, agent setup scan skipped: ${String(err)}`);
    return "";
  });

  const checkInput: CheckInput = {
    version: VERSION,
    coverage:
      coverageText === null ? { missingFile: coverageFile } : { text: coverageText, format, file: coverageFile },
    diff: await getDiff(input("base-ref"), deps),
    repoRoot: deps.workspace,
    threshold,
    repoFiles: lsFiles.split("\0").filter((p) => p !== ""),
    exclude: [...(config.coverage?.exclude ?? []), ...excludeInput],
    requireAgentSetup,
  };
  const report = check(checkInput);
  const markdown = renderMarkdown(report);

  const reportPath = deps.resolvePath(deps.tempDir, "pharn-ci", "report.json");
  await deps.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  deps.setOutput("report-path", reportPath);
  deps.setOutput("verdict", report.verdict);
  deps.setOutput("diff-coverage", report.diffCoverage?.percent?.toString() ?? "");

  await deps
    .writeSummary(markdown)
    .catch((err: unknown) => deps.warning(`could not write job summary: ${String(err)}`));

  if (comment && pr) await upsertComment(deps, pr.number, fitComment(`${COMMENT_MARKER}\n${markdown}`));

  deps.info(`pharn-ci verdict: ${report.verdict}`);
  if (report.verdict === "fail" && failOnThreshold) {
    const errors = report.messages.filter((m) => m.level === "error").map((m) => m.text);
    deps.setFailed(`pharn-ci: ${errors.join(" ")}`);
  }
  return report;
}

/** Diff of the change under test: base...HEAD, from local git if possible, else the GitHub API. */
async function getDiff(baseRefInput: string, deps: ActionDeps): Promise<CheckInput["diff"]> {
  // A leading "-" would reach git as an option (e.g. --output=<file>), not a revision.
  if (baseRefInput.startsWith("-")) throw new Error(`base-ref "${baseRefInput}" must not start with "-"`);
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
      return {
        unavailable:
          "pull_request_target checks out the base branch, not the PR; check out the PR head " +
          "(ref: github.event.pull_request.head.sha) to measure it",
      };
    }
  }

  const localBase = await resolveLocal(base, deps);
  if (localBase) {
    try {
      return {
        text: await deps.git([
          "diff",
          "--unified=0",
          "--no-color",
          "--no-ext-diff",
          "--find-renames",
          "--src-prefix=a/",
          "--dst-prefix=b/",
          "--end-of-options",
          `${localBase}...HEAD`,
        ]),
      };
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

/** Cut an over-long comment at a line break and point to the full report. */
export function fitComment(body: string): string {
  if (body.length <= MAX_COMMENT_LENGTH) return body;
  const limit = MAX_COMMENT_LENGTH - TRUNCATED_NOTE.length;
  const cut = body.lastIndexOf("\n", limit);
  return `${body.slice(0, cut > 0 ? cut : limit)}${TRUNCATED_NOTE}`;
}

/**
 * Create or update the one comment carrying COMMENT_MARKER: the oldest (lowest id) marker comment
 * of the token's own login. Concurrent runs on one PR can each find none and create one, so after
 * creating, the comments are listed again and newer own duplicates are deleted. Clean-up failures
 * are only warnings.
 */
export async function upsertComment(
  deps: Pick<ActionDeps, "api" | "info" | "warning">,
  issueNumber: number,
  body: string,
) {
  try {
    const [comments, viewer] = await Promise.all([deps.api.listComments(issueNumber), deps.api.viewerLogin()]);
    const [existing, ...duplicates] = ownComments(comments, viewer);
    if (existing) {
      await deps.api.updateComment(existing.id, body);
      deps.info(`updated pharn-ci comment ${existing.id}`);
      await deleteDuplicates(deps, duplicates);
      return;
    }
    await deps.api.createComment(issueNumber, body);
    deps.info("created pharn-ci comment");
    await removeRaceDuplicates(deps, issueNumber, viewer, body);
  } catch (err) {
    // Typical cause: PRs from forks get a read-only token.
    deps.warning(
      `could not post the PR comment (${errorText(err)}); ` +
        "the report is in the job summary. Grant `pull-requests: write` to enable comments.",
    );
  }
}

/** Anyone can post a comment containing the marker; only the ones this token wrote are pharn-ci's, oldest first. */
function ownComments(comments: IssueComment[], viewer: string): IssueComment[] {
  return comments
    .filter((c) => c.user?.login === viewer && c.body?.startsWith(COMMENT_MARKER))
    .sort((a, b) => a.id - b.id);
}

/** After a create: keep the oldest own marker comment, carrying this run's report, and delete the rest. */
async function removeRaceDuplicates(
  deps: Pick<ActionDeps, "api" | "info" | "warning">,
  issueNumber: number,
  viewer: string,
  body: string,
) {
  try {
    const [keep, ...duplicates] = ownComments(await deps.api.listComments(issueNumber), viewer);
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

/** Callers pass only comments from ownComments: the marker and the token's own login. */
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

async function loadConfig(path: string, deps: ActionDeps): Promise<PharnConfig> {
  const text = await deps.readFile(deps.resolvePath(deps.workspace, path));
  if (text === null) return {};
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

function parseBool(value: string, fallback: boolean, name: string): boolean {
  if (value === "") return fallback;
  if (/^(true|yes|on|1)$/i.test(value)) return true;
  if (/^(false|no|off|0)$/i.test(value)) return false;
  throw new Error(`${name} must be true or false, got "${value}"`);
}
