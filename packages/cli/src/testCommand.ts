import { constants } from "node:os";
import { parseArgs } from "node:util";
import {
  ConfigError,
  failuresAllQuarantined,
  type JunitResults,
  junitReport,
  parseExcludePattern,
  parseJunitSources,
  parseQuarantineList,
  QUARANTINE_FILE_MAX_BYTES,
  tallyJunit,
  utf8ByteLength,
} from "@pharn-ci/core";
import { readJunitFiles } from "@pharn-ci/node-io";
import type { CliDeps } from "./main.js";

export const TEST_HELP = `Usage:
  pharn-ci test [options] -- <command> [args...]

Runs the test command (without a shell, with this terminal's input and output), then reads its JUnit XML and prints a
short summary. Exits 0 when the command failed only because of tests on the quarantine list; otherwise exits with the
command's own code (128 + n when a signal n stopped it). Never makes a network call.

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
 * `pharn-ci test [options] -- <command> [args...]`: `argv` is what follows `test`. Runs the command without a shell,
 * reads the `--junit` files once it ended, and decides the exit code: the command's own (0 stays 0; 128 + n for a
 * signal, with no JUnit read), or 0 when it failed and the JUnit results show at least one failed test, every failed test
 * on the `--quarantine-file` list, and every matched file read whole. Usage and file problems exit 2.
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
  try {
    results = await readJunit(deps, patterns);
  } catch (err) {
    deps.stderr(`pharn-ci: could not read the JUnit files: ${err instanceof Error ? err.message : String(err)}\n`);
    return code;
  }
  for (const line of summaryLines(results, quarantine)) deps.stderr(`${line}\n`);
  if (code === 0) return 0;
  if (failuresAllQuarantined(results, tallyJunit(results, quarantine))) {
    deps.stderr(`pharn-ci: the command exited ${code} and every failed test is quarantined, so pharn-ci exits 0\n`);
    return 0;
  }
  return code;
}
