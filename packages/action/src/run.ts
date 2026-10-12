import {
  type CheckInput,
  check,
  isCoverageFormat,
  type PharnConfig,
  parseConfig,
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
}

/** The slice of the GitHub API the action uses. */
export interface GitHubApi {
  compareDiff(basehead: string): Promise<string>;
  listComments(issueNumber: number): Promise<IssueComment[]>;
  createComment(issueNumber: number, body: string): Promise<void>;
  updateComment(commentId: number, body: string): Promise<void>;
}

export interface ActionContext {
  eventName: string;
  sha: string;
  payload: {
    before?: string;
    pull_request?: { number: number; base: { sha: string }; head: { sha: string } };
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

  const format = input("coverage-format") || config.coverage?.format || "lcov";
  if (!isCoverageFormat(format) || format !== "lcov") {
    throw new Error(`coverage-format "${format}" is not supported yet (supported: lcov)`);
  }
  const thresholdInput = input("threshold");
  const threshold =
    thresholdInput !== "" ? parseThreshold(thresholdInput, "threshold") : (config.coverage?.threshold ?? null);
  const coverageFile = input("coverage-file") || config.coverage?.file;
  if (!coverageFile) throw new Error("no coverage file: set the coverage-file input or coverage.file in .pharn/ci.yml");
  const failOnThreshold = parseBool(input("fail-on-threshold"), true, "fail-on-threshold");
  const comment = parseBool(input("comment"), true, "comment");

  const coveragePath = deps.resolvePath(deps.workspace, coverageFile);
  const coverageText = await deps.readFile(coveragePath);
  const pr = deps.context.payload.pull_request;

  const lsFiles = await deps.git(["ls-files", "-z"]).catch((err: unknown) => {
    deps.warning(`git ls-files failed, agent setup scan skipped: ${String(err)}`);
    return "";
  });

  const checkInput: CheckInput = {
    version: VERSION,
    coverage: coverageText === null ? { missingFile: coverageFile } : { text: coverageText, format },
    diff: await getDiff(input("base-ref"), deps),
    repoRoot: deps.workspace,
    threshold,
    repoFiles: lsFiles.split("\0").filter((p) => p !== ""),
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

  if (comment && pr) await upsertComment(deps, pr.number, `${COMMENT_MARKER}\n${markdown}`);

  deps.info(`pharn-ci verdict: ${report.verdict}`);
  if (report.verdict === "fail" && failOnThreshold) {
    const errors = report.messages.filter((m) => m.level === "error").map((m) => m.text);
    deps.setFailed(`pharn-ci: ${errors.join(" ")}`);
  }
  return report;
}

/** Diff of the change under test: base...HEAD, from local git if possible, else the GitHub API. */
async function getDiff(baseRefInput: string, deps: ActionDeps): Promise<CheckInput["diff"]> {
  const { context } = deps;
  const pr = context.payload.pull_request;
  const base =
    baseRefInput ||
    pr?.base.sha ||
    (context.payload.before && !ZERO_SHA.test(context.payload.before) ? context.payload.before : "");
  if (!base) return { unavailable: "no base to diff against (not a pull request; set the base-ref input)" };

  // pull_request checks out the merge commit (context.sha); pull_request_target checks out the base.
  const head = context.eventName === "pull_request_target" && pr ? pr.head.sha : context.sha;

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
    deps.warning(`could not fetch the diff from the GitHub API: ${String(err)}`);
    return { unavailable: `could not get the diff for ${base}...${head} (use actions/checkout with fetch-depth: 0)` };
  }
}

async function resolveLocal(base: string, deps: ActionDeps): Promise<string | null> {
  const candidates = /^[0-9a-f]{40}$/i.test(base) ? [base] : [`origin/${base}`, base];
  for (const ref of candidates) {
    try {
      await deps.git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      return ref;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Create or update the one comment carrying COMMENT_MARKER. Never posts duplicates. */
export async function upsertComment(
  deps: Pick<ActionDeps, "api" | "info" | "warning">,
  issueNumber: number,
  body: string,
) {
  try {
    const comments = await deps.api.listComments(issueNumber);
    const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));
    if (existing) {
      await deps.api.updateComment(existing.id, body);
      deps.info(`updated pharn-ci comment ${existing.id}`);
    } else {
      await deps.api.createComment(issueNumber, body);
      deps.info("created pharn-ci comment");
    }
  } catch (err) {
    // Typical cause: PRs from forks get a read-only token.
    deps.warning(
      `could not post the PR comment (${err instanceof Error ? err.message : String(err)}); ` +
        "the report is in the job summary. Grant `pull-requests: write` to enable comments.",
    );
  }
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

function parseBool(value: string, fallback: boolean, name: string): boolean {
  if (value === "") return fallback;
  if (/^(true|yes|on|1)$/i.test(value)) return true;
  if (/^(false|no|off|0)$/i.test(value)) return false;
  throw new Error(`${name} must be true or false, got "${value}"`);
}
