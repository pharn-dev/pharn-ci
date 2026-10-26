import { parseArgs } from "node:util";
import {
  type AgentConfigSources,
  agentConfigSecretPaths,
  type CheckInput,
  COVERAGE_FORMAT_SELECTIONS,
  ConfigError,
  check,
  type DiffFile,
  type DirEntry,
  gitDiffArgs,
  type InputErrorText,
  type PharnConfig,
  type PythonIndexRun,
  type PythonSourceFile,
  type PythonTestIndex,
  parseConfig,
  parseLsTreeSizes,
  type RawInputs,
  readDiffChunks,
  renderMarkdown,
  resolveInputs,
  resolveTestIntegrityMode,
  scanAgentSetup,
  type TestSources,
  unavailableTestSources,
  VERSION,
} from "@pharn-ci/core";
import {
  gitChunks,
  indexPythonTestSources,
  indexPythonTests,
  readAgentConfigSources,
  readCoverageFiles,
  readDiscoveredCoverage,
  readTestSources,
} from "@pharn-ci/node-io";

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
  --coverage <file|glob>  Coverage report path or glob (repeatable). Default: coverage.file from config, then auto-discovery
  --coverage-format <f>  lcov, cobertura or auto. Default: coverage.format, then auto
  --coverage-root <dir>  Directory relative coverage paths start from. Default: coverage.root, then the repo root
  --base <ref>         Base to diff against (merge-base with HEAD). Default: origin/main
  --threshold <n>      Minimum diff coverage percent (0-100). Default: coverage.threshold
  --format <md|json>   Output format. Default: md
  --exclude <glob>     Leave matching changed files out of diff coverage (repeatable; adds to coverage.exclude)
  --require-agent-setup  Fail when the repo has no agent setup files. Default: setup.require, then off
  --expect-agent-setup <tool>  Report this agent tool when no setup file configures it (repeatable; adds to setup.expect)
  --test-integrity <m>  Test-integrity mode: block, warn or off. Default: warn; test_integrity.mode in the config can only tighten it
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
  };
  // Malformed --coverage-format, --coverage, --exclude, --coverage-root, --expect-agent-setup and --test-integrity flags are reported before any git
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

  const repoRoot = (await git(deps, ["rev-parse", "--show-toplevel"], "not inside a git repository")).trim();
  const config = await loadConfig(values.config, repoRoot, deps);
  // With no coverage path set anywhere, the report is looked for at the discovery candidates.
  const resolved = resolveInputs(config, raw, FLAG_ERRORS, { discoverCoverage: true });
  if (!resolved.ok) throw resolved.errors[0];
  const {
    coverageFile,
    coverageFormat,
    threshold,
    exclude,
    coverageRoot,
    requireAgentSetup,
    expectAgentSetup,
    testIntegrityMode,
  } = resolved.inputs;

  // Say which format was read and why, on stderr so stdout stays the report alone.
  const log = (line: string) => deps.stderr(`${line}\n`);
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

  const base = values.base ?? "origin/main";
  const diffArgs = gitDiffArgs(base);
  let diffFiles: DiffFile[];
  try {
    // Absolute: core makes it repo-relative against repoRoot, or finds it outside the repo.
    const configPath = values.config === undefined ? undefined : deps.resolvePath(deps.cwd, values.config);
    diffFiles = await readDiffChunks(gitChunks(deps, diffArgs), { configPath, repoRoot });
  } catch (err) {
    throw gitFailure(diffArgs, `could not diff against "${base}" (fetch it, or pass --base <ref>)`, err);
  }
  // The text of the touched test and test-config files, for the base-and-head signals. Mode off reads nothing.
  let testSources: TestSources | undefined;
  let pythonTestIndex: PythonTestIndex | undefined;
  if (resolveTestIntegrityMode(testIntegrityMode).mode !== "off") {
    if (deps.gitBatch === undefined) {
      testSources = unavailableTestSources("reading git objects is not available");
    } else {
      testSources = await readTestSources(
        { git: (args) => deps.git(args), gitBatch: deps.gitBatch },
        { base, head: "HEAD", diff: diffFiles },
      );
      if ("unavailable" in testSources.base) {
        deps.stderr(
          `pharn-ci: could not read the test and test-config files from git, so they are not compared: ${testSources.base.unavailable}\n`,
        );
      }
      // The Python test files of the sources, indexed by one interpreter run; nothing runs for JS/TS-only changes.
      pythonTestIndex = await indexPythonTestSources(testSources, deps.indexPython ?? indexPythonTests);
    }
  }
  // `--full-name -- :/` lists the whole repository relative to its root wherever the CLI runs, so coverage
  // paths are compared with the same names from a subdirectory.
  const lsFiles = await git(deps, ["ls-files", "-z", "--full-name", "--", ":/"], "git ls-files failed");
  const repoFiles = lsFiles.split("\0").filter((p) => p !== "");

  // The committed text of the agent config files, for the secret scan (check A7), always at HEAD. Nothing is read
  // without a batch git runner or when no tracked path is a scannable agent config file.
  let agentConfigSources: AgentConfigSources | undefined;
  if (deps.gitBatch !== undefined) {
    const agentConfigPaths = agentConfigSecretPaths(scanAgentSetup(repoFiles));
    if (agentConfigPaths.length > 0) {
      agentConfigSources = await readAgentConfigSources({ gitBatch: deps.gitBatch }, agentConfigPaths);
      if ("unavailable" in agentConfigSources) {
        deps.stderr(
          `pharn-ci: could not read the agent config files from git, so they are not scanned for secrets: ${agentConfigSources.unavailable}\n`,
        );
      }
    }
  }

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
    coverage,
    diff: { parsed: diffFiles },
    repoRoot,
    threshold,
    repoFiles,
    ...(repoFileBytes === undefined ? {} : { repoFileBytes }),
    ...(agentConfigSources === undefined ? {} : { agentConfigSources }),
    exclude,
    requireAgentSetup,
    ...(expectAgentSetup === undefined ? {} : { expectAgentSetup }),
    ...(testIntegrityMode === undefined ? {} : { testIntegrityMode }),
    ...(testSources === undefined ? {} : { testSources }),
    ...(pythonTestIndex === undefined ? {} : { pythonTestIndex }),
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
