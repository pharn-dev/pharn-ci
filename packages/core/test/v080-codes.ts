// v0.8.0 codes. Each v0.8.0 feature adds its own part of the " Codes added in v0.8.0:" sentence that the message-code
// description of report.v2.json gains, after the v0.7.0 sentence (v070-codes.ts). The schema pins that compare
// report.v2.json with an older commit take exactly this text out first (and, with `withoutV080SchemaEdits`, every other
// v0.8.0 schema insertion), so every other byte stays pinned. Features built in parallel add their part here as their
// own named constant; the sentence lists the parts in code-unit order of their codes.

/** Flaky tests' (A6: JUnit results, quarantine, the pharn-ci test wrapper) part of the v0.8.0 text. */
export const V080_FLAKY_TEXT =
  "FLAKY_QUARANTINED_FAILURES (info: failed tests of the JUnit results are on the org's quarantine list; the message names the counts, never a test name; pharn-ci never fails because a test failed), JUNIT_INVALID (warn: a JUnit XML file was refused whole for a DOCTYPE or other <! declaration, broken nesting, no testsuites or testsuite root or nesting deeper than 256; the message names up to 10 paths with a reason word each), JUNIT_NOT_FOUND (warn: JUnit paths were set and no file matched them) and JUNIT_TOO_LARGE (warn: the JUnit results went over the limits of one run, 50 files, 25 MiB or 20,000 test cases, or the search for files stopped at its limit; what is over is left out)";

/** Flaky tests' message codes, in code-unit order. */
export const V080_FLAKY_CODES = ["FLAKY_QUARANTINED_FAILURES", "JUNIT_INVALID", "JUNIT_NOT_FOUND", "JUNIT_TOO_LARGE"];

/**
 * Flaky tests' insertion into the `flaky` property of report.v2.json: its description, right after the opening brace, as
 * the exact bytes the file gains.
 */
export const V080_FLAKY_SCHEMA_TEXT = `
      "description": "The run's JUnit results (since 0.8.0), from the files the junit-paths input or the CLI's --junit flag names. Present only when at least one JUnit XML file was parsed. A test id is <classname>::<name>, where classname falls back to the file attribute and then to the name of the enclosing testsuite (the name alone when all three are empty); whitespace and control characters are collapsed to one space; an id over 500 UTF-16 code units is cut to 491 and ends in ~ and the 8 hex digits of its 32-bit FNV-1a hash. testCount counts every testcase, failed the failures and errors; a failed test whose id is on the org's quarantine list (applied unless the org policy sets flaky.quarantine to false) counts in quarantinedFailures, any other in unquarantinedFailures, and quarantined lists the distinct quarantined ids that failed, sorted, at most 200. uploaded is true only when the normalised results were stored on pharn.dev. pharn-ci never changes its verdict because a test failed.",`;

/** A13 (dependency safety, D01 to D05)'s part of the v0.8.0 text. */
export const V080_DEPENDENCY_TEXT =
  "DEPENDENCY_CHECK_INCOMPLETE (warn: a manifest or lockfile the change touches could not be read or parsed, so dependency safety did not check it), DEPENDENCY_D01 (error: an added npm or PyPI package the Action looked up does not exist in the registry), DEPENDENCY_D02 (warn: an added package was first published fewer than dependencies.min_age_days days before the head commit), DEPENDENCY_D03 (warn: an added unscoped npm package was downloaded fewer than dependencies.min_weekly_downloads times last week), DEPENDENCY_D04 (error: lockfile drift: a manifest's dependencies changed and the lockfile that governs it did not change or does not record them, or a lockfile gives the same version a different integrity hash), DEPENDENCY_D05 (error: an added or changed dependency or lockfile entry comes from a git repository, a URL outside the allowed registries or a local file, or a requirements file adds a package index outside them), DEPENDENCY_LOOKUP_UNAVAILABLE (warn: registry lookups did not complete for some added packages, so D01 to D03 were not checked for them); one message per code, naming counts, thresholds and up to 10 paths with lines, never a package name or file text";

/** A13's message codes, in code-unit order. */
export const V080_DEPENDENCY_CODES = [
  "DEPENDENCY_CHECK_INCOMPLETE",
  "DEPENDENCY_D01",
  "DEPENDENCY_D02",
  "DEPENDENCY_D03",
  "DEPENDENCY_D04",
  "DEPENDENCY_D05",
  "DEPENDENCY_LOOKUP_UNAVAILABLE",
];

/**
 * The text appended to the message-code description (no character in it is escaped by JSON): the parts in code-unit
 * order of their codes, A13's DEPENDENCY_ codes before the flaky tests' FLAKY_ and JUNIT_ codes.
 */
export const V080_CODE_TEXT = ` Codes added in v0.8.0: ${V080_DEPENDENCY_TEXT}, ${V080_FLAKY_TEXT}.`;

/** The message codes the v0.8.0 text names, in code-unit order. */
export const V080_CODES = [...V080_DEPENDENCY_CODES, ...V080_FLAKY_CODES];

/**
 * A13's insertion into the top-level properties of report.v2.json: the optional `dependencies` object, right after
 * `flaky`, as the exact bytes the file gains.
 */
export const V080_DEPENDENCIES_SCHEMA_TEXT = `,
    "dependencies": {
      "description": "Dependency safety (since 0.8.0): the dependencies a change adds or changes in npm manifests (package.json) and lockfiles (package-lock.json, npm-shrinkwrap.json, pnpm-lock.yaml, yarn.lock) and in Python manifests (requirements files, pyproject.toml) and lockfiles (poetry.lock, uv.lock), never the whole tree. D04 (lockfile drift) and D05 (a source outside the allowed registries) need no network; D01 to D03 come from registry lookups, which only the Action makes and only with the dependencies input set to lookup (or the config or org policy turning them on). Present only when the change touches a manifest or lockfile and the mode is not never; absent from a run that could not read the touched files' text at all.",
      "type": "object",
      "additionalProperties": false,
      "required": ["checked", "lookups", "signals"],
      "properties": {
        "checked": {
          "description": "How many manifest dependencies and lockfile entries the change added or changed.",
          "type": "integer",
          "minimum": 0
        },
        "lookups": {
          "description": "off: no registry lookups were asked for or could be made (the CLI never makes one); done: every planned lookup answered; unavailable: at least one did not, or the 50-lookup limit was reached (a DEPENDENCY_LOOKUP_UNAVAILABLE warn message says how many).",
          "enum": ["off", "done", "unavailable"]
        },
        "signals": {
          "description": "The findings, sorted by id, path, line and name, at most 200. Each comes with one DEPENDENCY_<id> message per id.",
          "type": "array",
          "maxItems": 200,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["id", "severity", "ecosystem", "path", "line", "detail"],
            "properties": {
              "id": { "enum": ["D01", "D02", "D03", "D04", "D05"] },
              "severity": {
                "description": "block for D01, D04 and D05 (an error message: the verdict fails); warn for D02 and D03.",
                "enum": ["block", "warn"]
              },
              "ecosystem": { "enum": ["npm", "pypi"] },
              "name": {
                "description": "The package name, only when it passes the npm or PyPI name grammar (at most 214 characters); otherwise absent.",
                "type": "string",
                "minLength": 1,
                "maxLength": 214
              },
              "version": {
                "description": "The version spec as declared or resolved, only when it is 1 to 100 letters, digits, spaces and . ^ ~ < > = * | ! , + _ - (never a URL, a git spec or a path); otherwise absent.",
                "type": "string",
                "minLength": 1,
                "maxLength": 100
              },
              "path": {
                "description": "Repo-relative path of the manifest or lockfile.",
                "type": "string",
                "minLength": 1
              },
              "line": { "description": "1-based line at HEAD, or null.", "type": ["integer", "null"], "minimum": 1 },
              "detail": {
                "description": "Fixed words, counts, thresholds and repo paths; never file text.",
                "type": "string",
                "minLength": 1,
                "maxLength": 300
              }
            }
          }
        },
        "truncated": {
          "description": "How many findings the 200-entry cap left out of signals. Absent when none were left out.",
          "type": "integer",
          "minimum": 1
        },
        "unread": {
          "description": "The touched manifests and lockfiles that were not checked, sorted by path, at most 100, each with a fixed reason; they come with one DEPENDENCY_CHECK_INCOMPLETE warn message. Absent when every touched file was read.",
          "type": "array",
          "maxItems": 100,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["path", "reason"],
            "properties": {
              "path": { "type": "string", "minLength": 1 },
              "reason": {
                "enum": [
                  "too-large",
                  "over-file-cap",
                  "over-total-cap",
                  "binary",
                  "missing",
                  "unsafe-path",
                  "unavailable",
                  "unparsable"
                ]
              }
            }
          }
        }
      }
    }`;

/** `text` with `part` taken out; throws unless it appears exactly once. */
function withoutOnce(text: string, part: string, name: string): string {
  const count = text.split(part).length - 1;
  if (count !== 1) throw new Error(`v0.8.0: expected the ${name} once, found ${count}`);
  return text.replace(part, "");
}

/** `text` (report.v2.json or its code description) with the v0.8.0 code text taken out; throws unless it appears once. */
export function withoutV080CodeText(text: string): string {
  return withoutOnce(text, V080_CODE_TEXT, "v0.8.0 code text");
}

/** report.v2.json with the description of `flaky` taken out; throws unless it appears once. */
export function withoutV080FlakySchema(text: string): string {
  return withoutOnce(text, V080_FLAKY_SCHEMA_TEXT, "flaky schema description");
}

/** report.v2.json with the top-level `dependencies` property taken out; throws unless it appears once. */
export function withoutV080DependenciesSchema(text: string): string {
  return withoutOnce(text, V080_DEPENDENCIES_SCHEMA_TEXT, "dependencies schema text");
}

/**
 * report.v2.json with every v0.8.0 property insertion taken out (the `flaky` description and the `dependencies`
 * property) while the code text stays; for the pins that cut the appended code texts themselves.
 */
export function withoutV080Properties(text: string): string {
  return withoutV080DependenciesSchema(withoutV080FlakySchema(text));
}

/** report.v2.json with every v0.8.0 insertion taken out: the code text, the `flaky` description and `dependencies`. */
export function withoutV080SchemaEdits(text: string): string {
  return withoutV080Properties(withoutV080CodeText(text));
}
