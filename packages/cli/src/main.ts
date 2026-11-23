import { parseArgs } from "node:util";
import {
  applyPolicy,
  type CheckInput,
  COVERAGE_FORMAT_SELECTIONS,
  ConfigError,
  check,
  type DiffFile,
  type DirEntry,
  escapeLogLine,
  escapeLogText,
  gitDiffArgs,
  type InputErrorText,
  type PythonIndexRun,
  type PythonSourceFile,
  parseExcludePattern,
  type RawInputs,
  readDiffChunks,
  renderMarkdown,
  resolveDependencySettings,
  resolveInputs,
  VERSION,
} from "@pharn-ci/core";
import {
  type FileStamp,
  gatherSources,
  gitChunks,
  headIsInBase,
  loadConfigInUse,
  lstatPath,
  type PathStat,
  readCoverageFiles,
  readDiscoveredCoverage,
  readPolicyFile,
} from "@pharn-ci/node-io";
import { readJunit, readQuarantineFile, runTestCommand } from "./testCommand.js";

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
  /**
   * Run git with args in `cwd`, write `input` to its stdin and resolve its stdout as bytes; rejects with stderr on
   * failure. Used to read the text of the test files from committed git objects (`cat-file`). Absent: that text is
   * not read, and the test sources are marked unavailable.
   */
  gitBatch?(args: string[], input: string): Promise<Uint8Array>;
  /**
   * Indexes `.py` test files with the Python test index (one run, base files then head files). Absent: node-io's
   * `indexPythonTests`, which runs the interpreter found on PATH. Only called when the test sources hold a `.py` test
   * file.
   */
  indexPython?(files: readonly PythonSourceFile[]): Promise<PythonIndexRun>;
  /** File contents, or null when the file does not exist. */
  readFile(path: string): Promise<string | null>;
  /**
   * The file as UTF-8 text chunks, or null when it does not exist; any other failure rejects, or throws during
   * iteration. Absent: the CLI makes one chunk of what `readFile` resolves.
   */
  readFileStream?(path: string): Promise<AsyncIterable<string> | null>;
  /**
   * The entries of a directory, with symbolic links reported as such and never followed; null when the
   * directory does not exist or is not a directory. Only called to expand a coverage glob or to discover the
   * coverage file.
   */
  listDir(path: string): Promise<DirEntry[] | null>;
  resolvePath(...segments: string[]): string;
  /**
   * `lstat` of a path without following a symbolic link; null when it does not exist. Only called to read a
   * `--policy-file`. Absent: node-io's `lstatPath`.
   */
  lstat?(path: string): Promise<PathStat | null>;
  /**
   * Runs a command in `cwd` without a shell, with the CLI's own stdin, stdout and stderr, and resolves how it ended: its
   * exit code, or the name of the signal that stopped it. Rejects when it cannot be started. Only `pharn-ci test` calls
   * it. Absent: `pharn-ci test` cannot run a command.
   */
  runCommand?(command: string, args: readonly string[]): Promise<{ code: number | null; signal: string | null }>;
  /**
   * The modification time and sha256 of a regular file, without following a symbolic link; the hash is null when the
   * file is larger than `maxHashBytes`. Null when the path does not exist or is not a regular file. Only `pharn-ci test`
   * calls it, before and after the command, to tell a JUnit file this run wrote from a stale one. Absent: node-io's
   * `fileStamp`.
   */
  fileStamp?(path: string, maxHashBytes: number): Promise<FileStamp | null>;
  stdout(text: string): void;
  stderr(text: string): void;
}

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_ERROR = 2;

const HELP = `pharn-ci ${VERSION} — can AI coding agents safely work in this repo?

Usage:
  pharn-ci check [options]
  pharn-ci test [--junit <glob>]... [--quarantine-file <path>] [--dry-run] -- <command> [args...]
                       Run a test command; see pharn-ci test --help

Options:
  --coverage <file|glob>  Coverage report path or glob (repeatable). Default: coverage.file from config, then auto-discovery
  --coverage-format <f>  lcov, cobertura or auto. Default: coverage.format, then auto
  --coverage-root <dir>  Directory relative coverage paths start from. Default: coverage.root, then the repo root
  --base <ref>         Base to diff against (merge-base with HEAD). Default: origin/main
  --threshold <n>      Minimum diff coverage percent (0-100). Default: coverage.threshold; a higher coverage.threshold applies over it
  --format <md|json>   Output format. Default: md
  --exclude <glob>     Leave matching changed files out of diff coverage (repeatable; adds to coverage.exclude)
  --require-agent-setup  Fail when the repo has no agent setup files. Default: setup.require, then off
  --expect-agent-setup <tool>  Report this agent tool when no setup file configures it (repeatable; adds to setup.expect)
  --test-integrity <m>  Test-integrity mode: block, warn or off. Default: warn; test_integrity.mode in the config can only tighten it
  --dependencies <m>   Dependency safety: auto (lockfile drift D04, off-registry sources D05), lookup or never. Default: auto. The CLI never looks packages up in a registry, so lookup runs as auto
  --dependency-allowed-host <host>  A registry host your team runs (Artifactory, Nexus, a private PyPI index) whose https URLs D05 accepts (repeatable; a host name only, at most 50)
  --config <path>      Config file. Default: <repo>/.pharn/ci.yml if present
  --policy-file <path> Org policy document to apply, relative to the repo root. It can only tighten; the CLI never fetches a policy
  --no-policy          Apply no org policy (the default; cannot be combined with --policy-file)
  --junit <file|glob>  JUnit XML to report in the Flaky section, relative to where you run the CLI (repeatable)
  --quarantine-file <path>  A JSON array of test ids to treat as quarantined in the JUnit results
  -h, --help           Show this help
  -v, --version        Show the version

Exit codes: 0 pass or warn, 1 fail, 2 usage or runtime error.
`;

export async function main(argv: string[], cliDeps: CliDeps): Promise<number> {
  // Every line written to stderr is escaped, at the sink: in a CI job stderr is the job log, whose lines the runner
  // reads for workflow commands, and a file name or a git message with a newline must not start `::stop-commands::` or
  // carry `##[...]`. stdout, the report, is left as it is.
  const deps: CliDeps = { ...cliDeps, stderr: (text) => cliDeps.stderr(escapeLogText(text)) };
  // `test` has options of its own and a command after `--`, so it is parsed apart.
  if (argv[0] === "test") return runTestCommand(argv.slice(1), deps);
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
  if (values["policy-file"] !== undefined && values["no-policy"] === true) {
    deps.stderr(`pharn-ci: --policy-file and --no-policy cannot be used together\n\n${HELP}`);
    return EXIT_ERROR;
  }

  try {
    return await runCheck(values, deps);
  } catch (err) {
    deps.stderr(`pharn-ci: ${errorMessage(err)}\n`);
    return EXIT_ERROR;
  }
}

/**
 * parseArgs words "`--threshold -1`" as "Did you forget to specify the option argument?", which misleads: the value
 * was given, it just starts with "-". Rewrite that one case; every other parse error keeps parseArgs' own text.
 */
function dashValueError(err: unknown, argv: string[]): Error | null {
  if ((err as { code?: unknown } | null)?.code !== "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") return null;
  const flag = /^Option '(--[^' ]+)' argument is ambiguous/.exec(errorMessage(err))?.[1];
  if (flag === undefined) return null;
  const at = argv.findIndex((arg, i) => arg === flag && argv[i + 1]?.startsWith("-"));
  const value = argv[at + 1];
  if (at === -1 || value === undefined) return null;
  return new Error(`${flag} ${value}: a value starting with "-" must be written ${flag}=${value}`);
}

function parse(argv: string[]) {
  try {
    return parseOptions(argv);
  } catch (err) {
    throw dashValueError(err, argv) ?? err;
  }
}

function parseOptions(argv: string[]) {
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
      "expect-agent-setup": { type: "string", multiple: true },
      "test-integrity": { type: "string" },
      dependencies: { type: "string" },
      "dependency-allowed-host": { type: "string", multiple: true },
      "policy-file": { type: "string" },
      "no-policy": { type: "boolean" },
      junit: { type: "string", multiple: true },
      "quarantine-file": { type: "string" },
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
  expectAgentSetup: "--expect-agent-setup",
  testIntegrity: "--test-integrity",
  dependencies: "--dependencies",
  dependencyAllowedHosts: "--dependency-allowed-host",
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
    expectAgentSetup: values["expect-agent-setup"],
    testIntegrity: values["test-integrity"],
    dependencies: values.dependencies,
    dependencyAllowedHosts: values["dependency-allowed-host"],
  };
  // Malformed --coverage-format, --coverage, --exclude, --coverage-root, --expect-agent-setup, --test-integrity,
  // --dependencies and --dependency-allowed-host flags are reported before any git
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
  const expectError = flagError("expectAgentSetup");
  if (expectError) throw expectError;
  const testIntegrityError = flagError("testIntegrity");
  if (testIntegrityError) throw testIntegrityError;
  const dependenciesError = flagError("dependencies");
  if (dependenciesError) throw dependenciesError;
  const dependencyAllowedHostsError = flagError("dependencyAllowedHosts");
  if (dependencyAllowedHostsError) throw dependencyAllowedHostsError;
  // A --junit pattern outside the working directory, or one the matcher does not support, is refused before any git call.
  const junitPatterns = values.junit ?? [];
  for (const pattern of junitPatterns) parseExcludePattern(pattern, "--junit");
  const quarantineFile = values["quarantine-file"];
  const quarantine = quarantineFile === undefined ? undefined : await readQuarantineFile(deps, quarantineFile);

  const repoRoot = (await git(deps, ["rev-parse", "--show-toplevel"], "not inside a git repository")).trim();

  // The diff is read before the config (CORE-95): with --base, the paths it changes decide which copy of the config
  // applies, as in the action.
  const base = values.base ?? "origin/main";
  const diffArgs = gitDiffArgs(base);
  // Absolute: core makes it repo-relative against repoRoot, or finds it outside the repo.
  const configPath = values.config === undefined ? undefined : deps.resolvePath(deps.cwd, values.config);
  let diffFiles: DiffFile[];
  try {
    diffFiles = await readDiffChunks(gitChunks(deps, diffArgs), { configPath, repoRoot });
  } catch (err) {
    throw gitFailure(diffArgs, `could not diff against "${base}" (fetch it, or pass --base <ref>)`, err);
  }
  // A base that is HEAD or a descendant of it (--base HEAD) gives an empty diff, which would pass as NO_COVERABLE_CHANGES
  // and hide every change from the diff-based checks (review finding 13). Only an empty diff can mean that, so git is
  // asked only then. The diff is of commits only (base...HEAD), never of the working tree, as in the action.
  let diff: CheckInput["diff"] = { parsed: diffFiles };
  if (diffFiles.length === 0 && (await headIsInBase(deps, base))) {
    const named = values.base === undefined ? `the base "${base}"` : `--base "${base}"`;
    diff = {
      unavailable:
        `${named} resolves to HEAD or a descendant of HEAD, so there is no change to measure; ` +
        "pass --base with the branch or commit the change is based on",
    };
  }
  // The config the check runs with, and which copy it is (CORE-95), as the action decides it. An explicit --config is
  // relative to where you run the CLI, the default to the repo root; errors name the absolute path.
  const configFile = configPath ?? deps.resolvePath(repoRoot, ".pharn/ci.yml");
  const { config, configSource, headConfigExclude } = await loadConfigInUse(deps, {
    path: configFile,
    name: configFile,
    explicit: configPath !== undefined,
    configPath,
    repoRoot,
    // Only a base the caller names decides the copy; without --base the working tree's config is read, as before.
    diff: values.base === undefined || "unavailable" in diff ? null : diffFiles,
    base,
  });
  // With no coverage path set anywhere, the report is looked for at the discovery candidates.
  const resolved = resolveInputs(config, raw, FLAG_ERRORS, { discoverCoverage: true });
  if (!resolved.ok) throw resolved.errors[0];
  // A --policy-file document is read before anything is measured and applied over the flags and the config; the CLI
  // never fetches a policy. A problem with the file is an Error, so exit 2. --no-policy and no flag change nothing.
  const policyFile = values["policy-file"];
  const policy =
    policyFile === undefined
      ? undefined
      : await readPolicyFile(
          { readFile: deps.readFile, resolvePath: deps.resolvePath, lstat: deps.lstat ?? lstatPath },
          { root: repoRoot, path: policyFile, label: "--policy-file" },
        );
  const application =
    policy === undefined ? undefined : applyPolicy({ config, raw, resolved: resolved.inputs }, policy);
  const effective = application?.inputs ?? resolved.inputs;
  const {
    coverageFile,
    coverageFormat,
    threshold,
    exclude,
    coverageRoot,
    requireAgentSetup,
    expectAgentSetup,
    testIntegrityMode,
    dependencies: dependencySettings,
  } = effective;

  // Say which format was read and why, on stderr so stdout stays the report alone. Each log line is one line: a newline
  // in a file name it names is replaced, so the name stays on its line (stderr escapes the rest, see main()).
  const log = (line: string) => deps.stderr(`${escapeLogLine(line)}\n`);
  let coverage: CheckInput["coverage"];
  if ("discover" in coverageFile) {
    // Discovered from the repo root, wherever the CLI runs; an ambiguity is a ConfigError, so exit 2.
    coverage = await readDiscoveredCoverage(deps, {
      repoRoot,
      format: coverageFormat,
      ...(coverageRoot === undefined ? {} : { coverageRoot }),
      howToSet: "pass --coverage <file> or set coverage.file in .pharn/ci.yml",
      log,
    });
  } else {
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
      log,
    });
    coverage = { files: coverageFiles, format: coverageFormat };
  }

  // `--full-name -- :/` lists the whole repository relative to its root wherever the CLI runs, so coverage
  // paths are compared with the same names from a subdirectory.
  const lsFiles = await git(deps, ["ls-files", "-z", "--full-name", "--", ":/"], "git ls-files failed");
  const repoFiles = lsFiles.split("\0").filter((p) => p !== "");

  // The sources the checks read from committed git objects, decided as in the action (CORE-136). The working tree is
  // the head under review, so the files at HEAD are read whether or not the diff is available; nothing read is printed.
  const gathered = await gatherSources(deps, {
    diff,
    base,
    checkout: "head",
    repoFiles,
    testIntegrityMode,
    dependencySettings,
    policy,
    log,
    warn: log,
  });
  // Dependency safety runs D04 and D05 only: the CLI never makes a network call (AGENTS.md rule 5).
  if (resolveDependencySettings(dependencySettings).mode === "lookup") {
    log("pharn-ci: the CLI makes no network call, so dependency registry lookups (D01 to D03) are off");
  }

  // The JUnit results, read only with --junit; nothing read is printed but counts and paths.
  const junit = junitPatterns.length === 0 ? undefined : await readJunit(deps, junitPatterns);

  const input: CheckInput = {
    version: VERSION,
    coverage,
    diff,
    repoRoot,
    threshold,
    repoFiles,
    ...gathered,
    ...(dependencySettings === undefined ? {} : { dependencySettings }),
    exclude,
    requireAgentSetup,
    ...(expectAgentSetup === undefined ? {} : { expectAgentSetup }),
    ...(testIntegrityMode === undefined ? {} : { testIntegrityMode }),
    ...(coverageRoot === undefined ? {} : { coverageRoot }),
    // Absolute: core makes it repo-relative against repoRoot, or finds it outside the repo.
    ...(configPath === undefined ? {} : { configPath }),
    ...(configSource === undefined ? {} : { configSource }),
    ...(headConfigExclude === undefined ? {} : { headConfigExclude }),
    ...(policy === undefined ? {} : { policy }),
    ...(application === undefined || application.ignored.length === 0 ? {} : { policyIgnored: application.ignored }),
    ...(application?.signalOverrides === undefined ? {} : { signalOverrides: application.signalOverrides }),
    ...(junit === undefined ? {} : { junit }),
    ...(junit === undefined || quarantine === undefined ? {} : { quarantine }),
  };
  const report = check(input);

  deps.stdout(format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
  return report.verdict === "fail" ? EXIT_FAIL : EXIT_OK;
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
