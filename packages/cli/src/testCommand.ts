import { constants } from "node:os";
import { parseArgs } from "node:util";
import {
  ConfigError,
  failuresAllQuarantined,
  JUNIT_MAX_TOTAL_BYTES,
  type JunitResults,
  junitReport,
  parseExcludePattern,
  parseJunitSources,
  parseQuarantineList,
  QUARANTINE_FILE_MAX_BYTES,
  tallyJunit,
  utf8ByteLength,
} from "@pharn-ci/core";
import { type FileStamp, fileStamp, matchJunitFiles, readJunitFiles } from "@pharn-ci/node-io";
import type { CliDeps } from "./main.js";

export const TEST_HELP = `Usage:
  pharn-ci test [options] -- <command> [args...]

Runs the test command (without a shell, with this terminal's input and output), then reads its JUnit XML and prints a
short summary. Exits 0 when the command failed only because of tests on the quarantine list, in JUnit files this run
wrote; otherwise exits with the command's own code (128 + n when a signal n stopped it). A matched file whose content
and modification time are both unchanged since before the command started is stale and keeps the command's code.
Never makes a network call.

Options:
  --junit <file|glob>      JUnit XML the command writes, relative to here (repeatable)
  --quarantine-file <path> A JSON array of test ids (<classname>::<name>) to treat as quarantined
  --dry-run                Print what would run and be read, without running anything
  -h, --help               Show this help
`;

/** Reads a `--quarantine-file`: a JSON array of test ids, at most 1 MiB. Every problem is a ConfigError (exit 2). */
export async function readQuarantineFile(deps: CliDeps, path: string): Promise<string[]> {
  const absolute = deps.resolvePath(deps.cwd, path);
  const text = await deps.readFile(absolute);
  if (text === null) throw new ConfigError(`--quarantine-file: file not found: ${absolute}`);
  if (utf8ByteLength(text) > QUARANTINE_FILE_MAX_BYTES) {
    throw new ConfigError(`--quarantine-file: ${absolute} is larger than 1 MiB`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ConfigError(`--quarantine-file: ${absolute} is not valid JSON`);
  }
  const list = parseQuarantineList(value);
  if (!list.ok) throw new ConfigError(`--quarantine-file: ${absolute} ${list.error}`);
  return list.ids;
}

/** Reads and parses the JUnit files of `--junit` patterns, relative to the working directory. */
export async function readJunit(deps: CliDeps, patterns: readonly string[]): Promise<JunitResults> {
  return parseJunitSources(await readJunitFiles(deps, { patterns, label: "--junit", baseDir: deps.cwd }));
}

/** The most stale paths one stderr line names; the rest are counted. */
const NAMED_STALE_PATHS = 10;

/**
 * The stamp (modification time and sha256) of every file the `--junit` patterns match before the command starts, by
 * path relative to the working directory, or null when that could not be recorded in full (the walk hit its limit, or a
 * file could not be stamped): then no file can be shown to be fresh. Files are hashed in match order within the 25 MiB
 * the reader reads at most; a file past that budget is stamped with its time alone (`sha256: null`).
 */
export async function recordJunitFiles(
  deps: CliDeps,
  patterns: readonly string[],
): Promise<Map<string, FileStamp> | null> {
  const stamp = deps.fileStamp ?? fileStamp;
  try {
    const matches = await matchJunitFiles(deps, { patterns, label: "--junit", baseDir: deps.cwd });
    if (matches.walkLimit) return null;
    const stamps = new Map<string, FileStamp>();
    let budget = JUNIT_MAX_TOTAL_BYTES;
    for (const path of matches.paths) {
      const found = await stamp(deps.resolvePath(deps.cwd, path), budget);
      if (found === null) continue;
      stamps.set(path, found);
      if (found.sha256 !== null) budget = Math.max(0, budget - found.size);
    }
    return stamps;
  } catch {
    return null;
  }
}

/**
 * The matched `paths` (as read after the command ended) this run did not write: each was there before the command started and still has the
 * same modification time, and its bytes are the same too (or could not be compared: a file past the hash budget, gone
 * or unreadable now). A file that was not there before, or whose time or bytes changed, is fresh.
 */
export async function staleJunitFiles(
  deps: CliDeps,
  before: ReadonlyMap<string, FileStamp>,
  paths: readonly string[],
): Promise<string[]> {
  const stamp = deps.fileStamp ?? fileStamp;
  const stale: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    const old = before.get(path);
    if (old === undefined) continue;
    let now: FileStamp | null;
    try {
      now = await stamp(deps.resolvePath(deps.cwd, path), old.sha256 === null ? 0 : JUNIT_MAX_TOTAL_BYTES);
    } catch {
      now = null;
    }
    if (now !== null && now.mtimeNs !== old.mtimeNs) continue;
    if (now !== null && old.sha256 !== null && now.sha256 !== null && now.sha256 !== old.sha256) continue;
    stale.push(path);
  }
  return stale;
}

/** Up to 10 paths, then `+N more`. */
function namedStale(paths: readonly string[]): string {
  const named = paths.slice(0, NAMED_STALE_PATHS).join(", ");
  return paths.length > NAMED_STALE_PATHS ? `${named}, +${paths.length - NAMED_STALE_PATHS} more` : named;
}

/** One argument as the dry run prints it: as it is when it holds only safe characters, else JSON-quoted. */
function shown(arg: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

/** The exit code of a command that a signal stopped: 128 + the signal's number (1 when the name is unknown). */
function signalExitCode(signal: string): number {
  const n = (constants.signals as Record<string, number | undefined>)[signal];
  return n === undefined ? 1 : 128 + n;
}

/** The lines the wrapper prints about the JUnit results (stderr): the counts, then each JUnit message. */
function summaryLines(results: JunitResults, quarantine: readonly string[] | undefined): string[] {
  const lines: string[] = [];
  if (results.parsed > 0) {
    const tally = tallyJunit(results, quarantine);
    const failures =
      tally.failed === 0
        ? "none failed"
        : `${tally.failed} failed (${tally.quarantinedFailures} quarantined, ${tally.unquarantinedFailures} not quarantined)`;
    lines.push(`pharn-ci: JUnit: ${tally.testCount} test(s) in ${results.parsed} file(s), ${failures}`);
  }
  for (const message of junitReport(results, quarantine).messages) {
    lines.push(`pharn-ci: ${message.code}: ${message.text}`);
  }
  return lines;
}

/**
 * `pharn-ci test [options] -- <command> [args...]`: `argv` is what follows `test`. Stamps the files the `--junit`
 * patterns match, runs the command without a shell, reads the `--junit` files once it ended, and decides the exit code:
 * the command's own (0 stays 0; 128 + n for a signal, with no JUnit read), or 0 when it failed and the JUnit results show
 * at least one failed test, every failed test on the `--quarantine-file` list, every matched file read whole, and no
 * matched file stale (unchanged since before the command started, so this run did not write it). Usage and file
 * problems exit 2.
 */
export async function runTestCommand(argv: string[], deps: CliDeps): Promise<number> {
  const at = argv.indexOf("--");
  const own = at === -1 ? argv : argv.slice(0, at);
  const command = at === -1 ? [] : argv.slice(at + 1);
  let values: { junit?: string[]; "quarantine-file"?: string; "dry-run"?: boolean; help?: boolean };
  try {
    values = parseArgs({
      args: own,
      allowPositionals: false,
      strict: true,
      options: {
        junit: { type: "string", multiple: true },
        "quarantine-file": { type: "string" },
        "dry-run": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }).values;
  } catch (err) {
    deps.stderr(`pharn-ci: ${err instanceof Error ? err.message : String(err)}\n\n${TEST_HELP}`);
    return 2;
  }
  if (values.help === true) {
    deps.stdout(TEST_HELP);
    return 0;
  }
  const [program, ...args] = command;
  if (program === undefined || program === "") {
    deps.stderr(`pharn-ci: pharn-ci test needs the test command after --\n\n${TEST_HELP}`);
    return 2;
  }
  const patterns = values.junit ?? [];
  let quarantine: string[] | undefined;
  try {
    for (const pattern of patterns) parseExcludePattern(pattern, "--junit");
    const file = values["quarantine-file"];
    if (file !== undefined) quarantine = await readQuarantineFile(deps, file);
  } catch (err) {
    deps.stderr(`pharn-ci: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  if (values["dry-run"] === true) {
    deps.stdout(`pharn-ci test (dry run): would run: ${[program, ...args].map(shown).join(" ")}\n`);
    deps.stdout(
      `pharn-ci test (dry run): would read JUnit from: ${patterns.length === 0 ? "nothing (no --junit)" : patterns.map(shown).join(", ")}\n`,
    );
    deps.stdout(
      `pharn-ci test (dry run): quarantine list: ${quarantine === undefined ? "none" : `${quarantine.length} test id(s)`}\n`,
    );
    return 0;
  }

  if (deps.runCommand === undefined) {
    deps.stderr("pharn-ci: running a command is not available here\n");
    return 2;
  }
  // Before the command starts: what every matched JUnit file looks like now, to tell later which ones it wrote.
  const before = patterns.length === 0 ? undefined : await recordJunitFiles(deps, patterns);
  let ended: { code: number | null; signal: string | null };
  try {
    ended = await deps.runCommand(program, args);
  } catch (err) {
    deps.stderr(`pharn-ci: could not run ${shown(program)}: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  if (ended.signal !== null) {
    const code = signalExitCode(ended.signal);
    deps.stderr(`pharn-ci: the command was stopped by ${ended.signal}, so pharn-ci exits ${code}\n`);
    return code;
  }
  const code = ended.code ?? 1;
  if (patterns.length === 0) return code;

  let results: JunitResults;
  let matched: string[];
  try {
    const sources = await readJunitFiles(deps, { patterns, label: "--junit", baseDir: deps.cwd });
    matched = sources.files.map((file) => file.path);
    results = parseJunitSources(sources);
  } catch (err) {
    deps.stderr(`pharn-ci: could not read the JUnit files: ${err instanceof Error ? err.message : String(err)}\n`);
    return code;
  }
  for (const line of summaryLines(results, quarantine)) deps.stderr(`${line}\n`);
  if (code === 0) return 0;
  if (before === null) {
    deps.stderr(
      `pharn-ci: could not record the JUnit files before the command ran, so no file can be shown to be this run's; pharn-ci keeps exit ${code}\n`,
    );
    return code;
  }
  if (before !== undefined) {
    const stale = await staleJunitFiles(deps, before, matched);
    if (stale.length > 0) {
      deps.stderr(
        `pharn-ci: stale JUnit file(s), unchanged since before the command ran, so this run did not write them: ${namedStale(stale)}; pharn-ci keeps exit ${code}\n`,
      );
      return code;
    }
  }
  if (failuresAllQuarantined(results, tallyJunit(results, quarantine))) {
    deps.stderr(`pharn-ci: the command exited ${code} and every failed test is quarantined, so pharn-ci exits 0\n`);
    return 0;
  }
  return code;
}
