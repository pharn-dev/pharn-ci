import { byCodeUnit, utf8ByteLength } from "../text.js";
import { type JunitCase, type JunitInvalidReason, parseJunitXml } from "./parse.js";

/** The most JUnit XML files one run reads. */
export const JUNIT_MAX_FILES = 50;
/** The most bytes of JUnit XML one run reads, all files together (25 MiB). */
export const JUNIT_MAX_TOTAL_BYTES = 26_214_400;
/** The most test cases one run keeps, all files together. */
export const JUNIT_MAX_CASES = 20_000;

/** Why the reader left a matched file out without parsing it: past the 50-file cap or past the 25 MiB cap. */
export type JunitDropReason = "file-cap" | "byte-cap";

/**
 * What the CLI or the Action found for the JUnit paths: each matched file (repo- or base-relative, forward slashes) with
 * its text, or with the reason the reader did not read it; and whether the glob walk stopped at its limit. A file is
 * listed once, in the order the reader met it.
 */
export interface JunitSources {
  files: ReadonlyArray<{ path: string; text: string } | { path: string; dropped: JunitDropReason }>;
  /** True when the glob walk stopped at its limit, so some files may not have been found. */
  walkLimit?: boolean;
}

/** The JUnit results of a run, as `check()` and the upload take them. */
export interface JunitResults {
  /** How many files were parsed. */
  parsed: number;
  /** The test cases of the parsed files, in file order then document order, at most 20,000. */
  cases: JunitCase[];
  /** The files that were read and refused, with the reason, sorted by path. */
  invalid: Array<{ path: string; reason: JunitInvalidReason }>;
  /** The files left out by the caps, sorted by path. */
  dropped: string[];
  /** How many test cases the 20,000-case cap left out. */
  droppedCases: number;
  /** See `JunitSources.walkLimit`. */
  walkLimit: boolean;
  /** True when no file matched the JUnit paths at all. */
  notFound: boolean;
}

/**
 * Every file of the sources parsed in order under the run's caps: the first 50 files, the first 25 MiB of UTF-8 (a file
 * that would go past it is left out, and so is every later one), and the first 20,000 test cases. A file the reader
 * already dropped stays dropped. The caps are applied here again, so a direct caller gets the same results.
 */
export function parseJunitSources(sources: JunitSources): JunitResults {
  const cases: JunitCase[] = [];
  const invalid: JunitResults["invalid"] = [];
  const dropped: string[] = [];
  let parsed = 0;
  let droppedCases = 0;
  let bytes = 0;
  let overBytes = false;
  sources.files.forEach((file, index) => {
    if ("dropped" in file || index >= JUNIT_MAX_FILES || overBytes) {
      if ("dropped" in file && file.dropped === "byte-cap") overBytes = true;
      dropped.push(file.path);
      return;
    }
    bytes += utf8ByteLength(file.text);
    if (bytes > JUNIT_MAX_TOTAL_BYTES) {
      overBytes = true;
      dropped.push(file.path);
      return;
    }
    const result = parseJunitXml(file.text, JUNIT_MAX_CASES - cases.length);
    if (!result.ok) {
      invalid.push({ path: file.path, reason: result.reason });
      return;
    }
    parsed++;
    cases.push(...result.cases);
    droppedCases += result.dropped;
  });
  return {
    parsed,
    cases,
    invalid: invalid.sort((a, b) => byCodeUnit(a.path, b.path)),
    dropped: dropped.sort(byCodeUnit),
    droppedCases,
    walkLimit: sources.walkLimit === true,
    notFound: sources.files.length === 0 && sources.walkLimit !== true,
  };
}
