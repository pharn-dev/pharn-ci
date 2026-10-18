import { parseArgs } from "node:util";
import {
  type CheckInput,
  COVERAGE_FORMAT_SELECTIONS,
  ConfigError,
  check,
  type DiffFile,
  type DirEntry,
  gitDiffArgs,
  type InputErrorText,
  type PharnConfig,
  parseConfig,
  parseLsTreeSizes,
  type RawInputs,
  readDiffChunks,
  renderMarkdown,
  resolveInputs,
  VERSION,
} from "@pharn-ci/core";
import { gitChunks, readCoverageFiles } from "@pharn-ci/node-io";

/** Everything the CLI touches outside itself; injected so tests can fake it. */
export interface CliDeps {
  cwd: string;
  /** Run git with args in `cwd`; resolves stdout, rejects with stderr on failure. */
  git(args: string[]): Promise<string>;
  /**
   * Run git with args in `cwd` and yield its stdout as UTF-8 text chunks, without holding it whole. Iteration throws
   * an Error whose message is git's stderr (or says that git timed out) when git fails. Absent: the CLI makes one
   * chunk of what `git` resolves.
   */
  gitStream?(args: string[]): AsyncIterable<string>;
  /** File contents, or null when the file does not exist. */
  readFile(path: string): Promise<string | null>;
  /**
   * The file as UTF-8 text chunks, or null when it does not exist; any other failure rejects, or throws during
   * iteration. Absent: the CLI makes one chunk of what `readFile` resolves.
   */
  readFileStream?(path: string): Promise<AsyncIterable<string> | null>;
  /**
   * The entries of a directory, with symbolic links reported as such and never followed; null when the
   * directory does not exist or is not a directory. Only called to expand a coverage glob.
   */
  listDir(path: string): Promise<DirEntry[] | null>;
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
  --coverage <file|glob>  Coverage report path or glob (repeatable). Default: coverage.file from config
  --coverage-format <f>  lcov, cobertura or auto. Default: coverage.format, then auto
  --coverage-root <dir>  Directory relative coverage paths start from. Default: coverage.root, then the repo root
  --base <ref>         Base to diff against (merge-base with HEAD). Default: origin/main
  --threshold <n>      Minimum diff coverage percent (0-100). Default: coverage.threshold
  --format <md|json>   Output format. Default: md
  --exclude <glob>     Leave matching changed files out of diff coverage (repeatable; adds to coverage.exclude)
  --require-agent-setup  Fail when the repo has no agent setup files. Default: setup.require, then off
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
      coverage: { type: "string", multiple: true },
      "coverage-format": { type: "string" },
      "coverage-root": { type: "string" },
      base: { type: "string" },
      threshold: { type: "string" },
      format: { type: "string" },
      config: { type: "string" },
      exclude: { type: "string", multiple: true },
      "require-agent-setup": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
}

type Values = ReturnType<typeof parse>["values"];

/** How the CLI names its flags in input errors. */
const FLAG_ERRORS: InputErrorText = {
  coverageFormat: (value) =>
    `--coverage-format must be one of: ${COVERAGE_FORMAT_SELECTIONS.join(", ")} (got "${value}")`,
  threshold: "--threshold",
  coverageFile: "--coverage",
  exclude: "--exclude",
  coverageRoot: "--coverage-root",
  noCoverageFile: "no coverage file: pass --coverage <file> or set coverage.file in .pharn/ci.yml",
};

async function runCheck(values: Values, deps: CliDeps): Promise<number> {
  const format = values.format ?? "md";
  if (format !== "md" && format !== "json") throw new ConfigError(`--format must be "md" or "json"`);
  const raw: RawInputs = {
    coverageFile: values.coverage,
    coverageFormat: values["coverage-format"],
    threshold: values.threshold,
    exclude: values.exclude,
    // An empty flag counts as absent, like an empty Action input.
    coverageRoot: values["coverage-root"]?.trim() ? values["coverage-root"] : undefined,
    requireAgentSetup: values["require-agent-setup"],
  };
  // Malformed --coverage-format, --coverage, --exclude and --coverage-root flags are reported before any git
  // call: they need no config.
  const flagsAlone = resolveInputs({}, raw, FLAG_ERRORS);
  const flagError = (input: keyof RawInputs) =>
    flagsAlone.ok ? undefined : flagsAlone.errors.find((e) => e.input === input);
  const formatError = flagError("coverageFormat");
  if (formatError) throw formatError;
  // A leading "-" would reach git as an option (e.g. --output=<file>), not a revision.
  if (values.base?.startsWith("-")) throw new ConfigError(`--base "${values.base}" must not start with "-"`);
  // Without the flag, "no coverage file" may be answered by the config, so it is not an error yet.
  const coverageFileError = raw.coverageFile === undefined ? undefined : flagError("coverageFile");
  if (coverageFileError) throw coverageFileError;
  const excludeError = flagError("exclude");
  if (excludeError) throw excludeError;
  const coverageRootError = flagError("coverageRoot");
  if (coverageRootError) throw coverageRootError;

  const repoRoot = (await git(deps, ["rev-parse", "--show-toplevel"], "not inside a git repository")).trim();
  const config = await loadConfig(values.config, repoRoot, deps);
  const resolved = resolveInputs(config, raw, FLAG_ERRORS);
  if (!resolved.ok) throw resolved.errors[0];
  const { coverageFile, coverageFormat, threshold, exclude, coverageRoot, requireAgentSetup } = resolved.inputs;

  // A --coverage entry is relative to where you run the CLI; a config entry is relative to the repo root.
  const coverageBase = coverageFile.fromConfig ? repoRoot : deps.cwd;
  const coverageLabel = coverageFile.fromConfig ? '"coverage.file"' : "--coverage";
  // Every entry is resolved and every file read before the check; a file reached twice is read once.
  const coverageFiles = await readCoverageFiles(deps, {
    entries: coverageFile.path,
    label: coverageLabel,
    baseDir: coverageBase,
    format: coverageFormat,
    repoRoot,
    ...(coverageRoot === undefined ? {} : { coverageRoot }),
    // Named by absolute path.
    name: (entry) => deps.resolvePath(coverageBase, entry),
    // Say which format was read and why, on stderr so stdout stays the report alone.
    log: (line) => deps.stderr(`${line}\n`),
  });

  const base = values.base ?? "origin/main";
  const diffArgs = gitDiffArgs(base);
  let diffFiles: DiffFile[];
  try {
    diffFiles = await readDiffChunks(gitChunks(deps, diffArgs));
  } catch (err) {
    throw gitFailure(diffArgs, `could not diff against "${base}" (fetch it, or pass --base <ref>)`, err);
  }
  // `--full-name -- :/` lists the whole repository relative to its root wherever the CLI runs, so coverage
  // paths are compared with the same names from a subdirectory.
  const lsFiles = await git(deps, ["ls-files", "-z", "--full-name", "--", ":/"], "git ls-files failed");

  // File sizes in HEAD, so an empty agent setup file can be reported. Optional: without them the check still runs.
  let repoFileBytes: Map<string, number> | undefined;
  try {
    repoFileBytes = parseLsTreeSizes(await deps.git(["ls-tree", "-r", "-l", "-z", "--full-tree", "HEAD"]));
  } catch (err) {
    const firstLine = errorMessage(err).trim().split("\n")[0] ?? "";
    deps.stderr(`pharn-ci: git ls-tree failed, so empty agent setup files are not reported: ${firstLine}\n`);
  }

  const input: CheckInput = {
    version: VERSION,
    coverage: { files: coverageFiles, format: coverageFormat },
    diff: { parsed: diffFiles },
    repoRoot,
    threshold,
    repoFiles: lsFiles.split("\0").filter((p) => p !== ""),
    ...(repoFileBytes === undefined ? {} : { repoFileBytes }),
    exclude,
    requireAgentSetup,
    ...(coverageRoot === undefined ? {} : { coverageRoot }),
    // Absolute: core makes it repo-relative against repoRoot, or finds it outside the repo.
    ...(values.config === undefined ? {} : { configPath: deps.resolvePath(deps.cwd, values.config) }),
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
    throw gitFailure(args, context, err);
  }
}

/** A failed git call, worded the same whether git was read whole or as a stream. */
function gitFailure(args: string[], context: string, err: unknown): Error {
  return new Error(`${context}\n  git ${args.join(" ")}: ${errorMessage(err).trim()}`);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
