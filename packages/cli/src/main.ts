import { parseArgs } from "node:util";
import {
  type CheckInput,
  COVERAGE_FORMAT_SELECTIONS,
  ConfigError,
  check,
  chooseCoverageFormat,
  coverageChoiceLine,
  isCoverageFormatSelection,
  type PharnConfig,
  parseConfig,
  parseExcludePattern,
  parseThreshold,
  renderMarkdown,
  VERSION,
} from "@pharn-ci/core";

/** Everything the CLI touches outside itself; injected so tests can fake it. */
export interface CliDeps {
  cwd: string;
  /** Run git with args in `cwd`; resolves stdout, rejects with stderr on failure. */
  git(args: string[]): Promise<string>;
  /** File contents, or null when the file does not exist. */
  readFile(path: string): Promise<string | null>;
  resolvePath(...segments: string[]): string;
  stdout(text: string): void;
  stderr(text: string): void;
}

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_ERROR = 2;

const HELP = `pharn-ci ${VERSION} — can AI coding agents safely work in this repo?

Usage:
  pharn-ci check [options]

Options:
  --coverage <file>    Coverage report. Default: coverage.file from config
  --coverage-format <f>  lcov, cobertura or auto. Default: coverage.format, then auto
  --base <ref>         Base to diff against (merge-base with HEAD). Default: origin/main
  --threshold <n>      Minimum diff coverage percent (0-100). Default: coverage.threshold
  --format <md|json>   Output format. Default: md
  --exclude <glob>     Leave matching changed files out of diff coverage (repeatable; adds to coverage.exclude)
  --config <path>      Config file. Default: <repo>/.pharn/ci.yml if present
  -h, --help           Show this help
  -v, --version        Show the version

Exit codes: 0 pass or warn, 1 fail, 2 usage or runtime error.
`;

export async function main(argv: string[], deps: CliDeps): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (err) {
    deps.stderr(`pharn-ci: ${errorMessage(err)}\n\n${HELP}`);
    return EXIT_ERROR;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    deps.stdout(`${VERSION}\n`);
    return EXIT_OK;
  }
  if (values.help || positionals.length === 0) {
    (values.help ? deps.stdout : deps.stderr)(HELP);
    return values.help ? EXIT_OK : EXIT_ERROR;
  }
  if (positionals[0] !== "check" || positionals.length > 1) {
    deps.stderr(`pharn-ci: unknown command "${positionals.join(" ")}"\n\n${HELP}`);
    return EXIT_ERROR;
  }

  try {
    return await runCheck(values, deps);
  } catch (err) {
    deps.stderr(`pharn-ci: ${errorMessage(err)}\n`);
    return EXIT_ERROR;
  }
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      coverage: { type: "string" },
      "coverage-format": { type: "string" },
      base: { type: "string" },
      threshold: { type: "string" },
      format: { type: "string" },
      config: { type: "string" },
      exclude: { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
}

type Values = ReturnType<typeof parse>["values"];

async function runCheck(values: Values, deps: CliDeps): Promise<number> {
  const format = values.format ?? "md";
  if (format !== "md" && format !== "json") throw new ConfigError(`--format must be "md" or "json"`);
  const coverageFormatFlag = values["coverage-format"];
  if (coverageFormatFlag !== undefined && !isCoverageFormatSelection(coverageFormatFlag)) {
    throw new ConfigError(
      `--coverage-format must be one of: ${COVERAGE_FORMAT_SELECTIONS.join(", ")} (got "${coverageFormatFlag}")`,
    );
  }
  // A leading "-" would reach git as an option (e.g. --output=<file>), not a revision.
  if (values.base?.startsWith("-")) throw new ConfigError(`--base "${values.base}" must not start with "-"`);
  const excludeFlags = (values.exclude ?? []).map((p) => parseExcludePattern(p, "--exclude"));

  const repoRoot = (await git(deps, ["rev-parse", "--show-toplevel"], "not inside a git repository")).trim();
  const config = await loadConfig(values.config, repoRoot, deps);

  const threshold =
    values.threshold !== undefined
      ? parseThreshold(values.threshold, "--threshold")
      : (config.coverage?.threshold ?? null);

  const coverageFormat = coverageFormatFlag ?? config.coverage?.format ?? "auto";

  // A --coverage path is relative to where you run the CLI; a config path is relative to the repo root.
  const coveragePath =
    values.coverage !== undefined
      ? deps.resolvePath(deps.cwd, values.coverage)
      : config.coverage?.file !== undefined
        ? deps.resolvePath(repoRoot, config.coverage.file)
        : undefined;
  if (coveragePath === undefined) {
    throw new ConfigError("no coverage file: pass --coverage <file> or set coverage.file in .pharn/ci.yml");
  }
  const coverageText = await deps.readFile(coveragePath);
  // Say which format was read and why, on stderr so stdout stays the report alone.
  if (coverageText !== null) {
    deps.stderr(`${coverageChoiceLine(chooseCoverageFormat(coverageText, coverageFormat))}\n`);
  }

  const base = values.base ?? "origin/main";
  const diffText = await git(
    deps,
    [
      "diff",
      "--unified=0",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--end-of-options",
      `${base}...HEAD`,
    ],
    `could not diff against "${base}" (fetch it, or pass --base <ref>)`,
  );
  const lsFiles = await git(deps, ["ls-files", "-z"], "git ls-files failed");

  const input: CheckInput = {
    version: VERSION,
    coverage:
      coverageText === null
        ? { missingFile: coveragePath }
        : { text: coverageText, format: coverageFormat, file: coveragePath },
    diff: { text: diffText },
    repoRoot,
    threshold,
    repoFiles: lsFiles.split("\0").filter((p) => p !== ""),
    exclude: [...(config.coverage?.exclude ?? []), ...excludeFlags],
  };
  const report = check(input);

  deps.stdout(format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
  return report.verdict === "fail" ? EXIT_FAIL : EXIT_OK;
}

async function loadConfig(explicit: string | undefined, repoRoot: string, deps: CliDeps): Promise<PharnConfig> {
  const path =
    explicit !== undefined ? deps.resolvePath(deps.cwd, explicit) : deps.resolvePath(repoRoot, ".pharn/ci.yml");
  const text = await deps.readFile(path);
  if (text === null) {
    if (explicit !== undefined) throw new ConfigError(`config file not found: ${path}`);
    return {};
  }
  try {
    return parseConfig(text);
  } catch (err) {
    throw new ConfigError(`${path}: ${errorMessage(err)}`);
  }
}

async function git(deps: CliDeps, args: string[], context: string): Promise<string> {
  try {
    return await deps.git(args);
  } catch (err) {
    throw new Error(`${context}\n  git ${args.join(" ")}: ${errorMessage(err).trim()}`);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
