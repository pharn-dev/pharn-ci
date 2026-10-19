import {
  ConfigError,
  isCoverageFormatSelection,
  type PharnConfig,
  parseAgentToolNames,
  parseCoverageRoot,
  parseExcludePattern,
  parseThreshold,
} from "./config.js";
import type { CoverageFormatSelection } from "./coverage/types.js";
import { coverageEntryList, parseCoverageEntries } from "./coverageEntries.js";
import type { AgentTool } from "./setup/summary.js";

/**
 * Settings as the CLI flags or Action inputs gave them, before `.pharn/ci.yml` is applied.
 * `undefined` means not given; the adapter decides what counts as not given (the Action treats an
 * empty input as not given, the CLI does not).
 */
export interface RawInputs {
  /** One path or glob, or a list of them; an empty list counts as not given. */
  coverageFile?: string | readonly string[] | undefined;
  coverageFormat?: string | undefined;
  threshold?: string | undefined;
  exclude?: readonly string[] | undefined;
  coverageRoot?: string | undefined;
  requireAgentSetup?: boolean | undefined;
  /** Agent tool names the report names when no setup file configures them; added to `setup.expect`. */
  expectAgentSetup?: readonly string[] | undefined;
}

/** How an adapter names its flags or inputs in error messages. */
export interface InputErrorText {
  /** The error for a coverage format that is not lcov, cobertura or auto. */
  coverageFormat(value: string): string;
  /** Label for a threshold that is not a number between 0 and 100. */
  threshold: string;
  /** Label for a coverage file glob the matcher does not support. Defaults to "coverage file". */
  coverageFile?: string;
  /** Label for an exclusion pattern the matcher does not support. */
  exclude: string;
  /** Label for a coverage root that is not a repo-relative directory. */
  coverageRoot: string;
  /** Label for an expected agent tool that is not in the fixed tool list. Defaults to "agent tool". */
  expectAgentSetup?: string;
  /** The error when neither the input nor the config names a coverage file. */
  noCoverageFile: string;
}

/** The settings a run uses: inputs first, then `.pharn/ci.yml`, then the defaults. */
export interface ResolvedInputs {
  /**
   * The coverage file (or the list of files and globs) as given, unresolved; `fromConfig` says which base
   * directory it is relative to. `{ discover: true }` when none was given and the caller asked for
   * auto-discovery (`options.discoverCoverage`).
   */
  coverageFile: { path: string | readonly string[]; fromConfig: boolean } | { discover: true };
  coverageFormat: CoverageFormatSelection;
  threshold: number | null;
  /** Config patterns first, then the input's; all validated and normalized. */
  exclude: string[];
  /** Normalized repo-relative directory relative coverage paths start from; undefined means the repo root. */
  coverageRoot: string | undefined;
  requireAgentSetup: boolean;
  /**
   * Config `setup.expect` first, then the input's; validated and de-duplicated, first occurrence kept.
   * Absent when nothing is expected, so settings that expect nothing resolve exactly as before.
   */
  expectAgentSetup?: AgentTool[];
}

/** An invalid setting, naming the raw input it came from (the coverage file one: neither input nor config). */
export class InputError extends ConfigError {
  constructor(
    readonly input: keyof RawInputs,
    message: string,
  ) {
    super(message);
  }
}

export type ResolveInputsResult =
  | { ok: true; inputs: ResolvedInputs }
  | { ok: false; errors: [InputError, ...InputError[]] };

/**
 * Merge the CLI flags or Action inputs with a parsed `.pharn/ci.yml`. Pure. Every invalid setting
 * yields one error, in the order coverage format, threshold, coverage file, exclusion patterns,
 * coverage root, expected agent tools. With `options.discoverCoverage`, no coverage file given anywhere is not
 * an error: `coverageFile` resolves to `{ discover: true }` and the adapter looks for the report.
 */
export function resolveInputs(
  config: PharnConfig,
  raw: RawInputs,
  text: InputErrorText,
  options: { discoverCoverage?: boolean } = {},
): ResolveInputsResult {
  const errors: InputError[] = [];
  const attempt = <T>(input: keyof RawInputs, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (err) {
      if (!(err instanceof ConfigError)) throw err;
      errors.push(new InputError(input, err.message));
      return undefined;
    }
  };

  // A config format is already validated by parseConfig; only the input can be unsupported.
  const coverageFormat = raw.coverageFormat ?? config.coverage?.format ?? "auto";
  if (!isCoverageFormatSelection(coverageFormat)) {
    errors.push(new InputError("coverageFormat", text.coverageFormat(coverageFormat)));
  }

  const threshold =
    raw.threshold !== undefined
      ? attempt("threshold", () => parseThreshold(raw.threshold, text.threshold))
      : (config.coverage?.threshold ?? null);

  const givenCoverageFile =
    typeof raw.coverageFile === "object" && raw.coverageFile.length === 0 ? undefined : raw.coverageFile;
  if (givenCoverageFile !== undefined) {
    // Entries with glob syntax follow the exclusion rules; a literal path is taken as given.
    attempt("coverageFile", () =>
      parseCoverageEntries(coverageEntryList(givenCoverageFile), text.coverageFile ?? "coverage file"),
    );
  }
  const coverageFile: ResolvedInputs["coverageFile"] | undefined =
    givenCoverageFile !== undefined
      ? { path: givenCoverageFile, fromConfig: false }
      : config.coverage?.file !== undefined
        ? { path: config.coverage.file, fromConfig: true }
        : options.discoverCoverage === true
          ? { discover: true }
          : undefined;
  if (coverageFile === undefined) errors.push(new InputError("coverageFile", text.noCoverageFile));

  const exclude = attempt("exclude", () => (raw.exclude ?? []).map((p) => parseExcludePattern(p, text.exclude)));

  // A config root is already validated and normalized by parseConfig; the input overrides it.
  const coverageRoot =
    raw.coverageRoot !== undefined
      ? attempt("coverageRoot", () => parseCoverageRoot(raw.coverageRoot as string, text.coverageRoot))
      : config.coverage?.root;

  const expectAgentSetup = attempt("expectAgentSetup", () =>
    parseAgentToolNames(raw.expectAgentSetup ?? [], text.expectAgentSetup ?? "agent tool"),
  );

  const [first, ...rest] = errors;
  if (first !== undefined) return { ok: false, errors: [first, ...rest] };
  // The config's tools first, then the input's, each once.
  const expectedTools = [...new Set([...(config.setup?.expect ?? []), ...(expectAgentSetup as AgentTool[])])];
  // No errors: every value above was resolved.
  return {
    ok: true,
    inputs: {
      coverageFile: coverageFile as ResolvedInputs["coverageFile"],
      coverageFormat: coverageFormat as CoverageFormatSelection,
      threshold: threshold as number | null,
      exclude: [...(config.coverage?.exclude ?? []), ...(exclude as string[])],
      coverageRoot,
      // Absent, setup.require decides, then off. The CLI flag can only turn it on.
      requireAgentSetup: raw.requireAgentSetup ?? config.setup?.require ?? false,
      // The config's tools first, then the input's, each once.
      ...(expectedTools.length > 0 ? { expectAgentSetup: expectedTools } : {}),
    },
  };
}

/**
 * Arguments for `git diff` of the change under review: `base...head`, zero context lines, no color
 * or external diff driver, fixed `a/` and `b/` prefixes whatever the user's git config says. The
 * revision range is the only user-influenced argument and comes after `--end-of-options`.
 */
export function gitDiffArgs(base: string, head = "HEAD"): string[] {
  return [
    "diff",
    "--unified=0",
    "--no-color",
    "--no-ext-diff",
    "--find-renames",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--end-of-options",
    `${base}...${head}`,
  ];
}
