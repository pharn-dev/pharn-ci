import {
  ConfigError,
  isCoverageFormatSelection,
  type PharnConfig,
  parseExcludePattern,
  parseThreshold,
} from "./config.js";
import type { CoverageFormatSelection } from "./coverage/types.js";

/**
 * Settings as the CLI flags or Action inputs gave them, before `.pharn/ci.yml` is applied.
 * `undefined` means not given; the adapter decides what counts as not given (the Action treats an
 * empty input as not given, the CLI does not).
 */
export interface RawInputs {
  coverageFile?: string | undefined;
  coverageFormat?: string | undefined;
  threshold?: string | undefined;
  exclude?: readonly string[] | undefined;
  requireAgentSetup?: boolean | undefined;
}

/** How an adapter names its flags or inputs in error messages. */
export interface InputErrorText {
  /** The error for a coverage format that is not lcov, cobertura or auto. */
  coverageFormat(value: string): string;
  /** Label for a threshold that is not a number between 0 and 100. */
  threshold: string;
  /** Label for an exclusion pattern the matcher does not support. */
  exclude: string;
  /** The error when neither the input nor the config names a coverage file. */
  noCoverageFile: string;
}

/** The settings a run uses: inputs first, then `.pharn/ci.yml`, then the defaults. */
export interface ResolvedInputs {
  /** The coverage file as given, unresolved; `fromConfig` says which base directory it is relative to. */
  coverageFile: { path: string; fromConfig: boolean };
  coverageFormat: CoverageFormatSelection;
  threshold: number | null;
  /** Config patterns first, then the input's; all validated and normalized. */
  exclude: string[];
  requireAgentSetup: boolean;
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
 * yields one error, in the order coverage format, threshold, coverage file, exclusion patterns.
 */
export function resolveInputs(config: PharnConfig, raw: RawInputs, text: InputErrorText): ResolveInputsResult {
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

  const coverageFile =
    raw.coverageFile !== undefined
      ? { path: raw.coverageFile, fromConfig: false }
      : config.coverage?.file !== undefined
        ? { path: config.coverage.file, fromConfig: true }
        : undefined;
  if (coverageFile === undefined) errors.push(new InputError("coverageFile", text.noCoverageFile));

  const exclude = attempt("exclude", () => (raw.exclude ?? []).map((p) => parseExcludePattern(p, text.exclude)));

  const [first, ...rest] = errors;
  if (first !== undefined) return { ok: false, errors: [first, ...rest] };
  // No errors: every value above was resolved.
  return {
    ok: true,
    inputs: {
      coverageFile: coverageFile as ResolvedInputs["coverageFile"],
      coverageFormat: coverageFormat as CoverageFormatSelection,
      threshold: threshold as number | null,
      exclude: [...(config.coverage?.exclude ?? []), ...(exclude as string[])],
      // Absent, setup.require decides, then off. The CLI flag can only turn it on.
      requireAgentSetup: raw.requireAgentSetup ?? config.setup?.require ?? false,
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
