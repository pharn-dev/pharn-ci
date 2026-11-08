// v0.7.0 codes. Each v0.7.0 feature adds its own part of the " Codes added in v0.7.0:" sentence that the message-code
// description of report.v2.json gains, after the v0.6.0 sentence (v060-codes.ts). The schema pins that compare
// report.v2.json with an older commit take exactly this text out first (and, with `withoutV070SchemaEdits`, every other
// v0.7.0 schema insertion), so every other byte stays pinned. Features built in parallel add their part here as their
// own named constant; the sentence lists the parts in code-unit order of their codes.

/** A8 step 1 (tests exercise the changed lines)'s part of the v0.7.0 text. */
export const V070_EXERCISE_TEXT =
  "TESTS_NOT_EXERCISING_CHANGES (warn, never an error, at most once per report: changed JS/TS source files that no JS/TS test file the change adds or modifies imports directly with a relative import while keeping or raising its assertion count; the message names the count checked, the count not exercised and up to 10 paths, then +N more, and testIntegrity.exercise lists up to 200 paths, never file text)";

/** Stale instructions' (Horizon 2 item H3, SI01 to SI04) part of the v0.7.0 text. */
export const V070_SETUP_TEXT =
  "SETUP_STALE_SI01, SETUP_STALE_SI02 and SETUP_STALE_SI03 (warn: an agent instruction file names a package-manager script or make target that the root package.json or Makefile does not define (SI01), a path in an inline code span that is not tracked (SI02), or a file it tells the agent to read, by a Markdown link or an @path import, that is not tracked (SI03), and the change touches that instruction file or removes the path, file, script or target it names; each finding is in setupHealth.stale; the message names up to 5 locations as path and line and the count, never the instruction's text) and SETUP_STALE_SI04 (info: an agent instruction file whose last commit is more than 90 days older than HEAD's commit names a file this change edits)";

/** H4 (prompt-injection surface scan, PI01 to PI05)'s part of the v0.7.0 text: the six INJECTION_ codes. */
export const V070_INJECTION_TEXT =
  "INJECTION_PI01 (error by default, or the level the org policy's injection.signals sets: an added line carries an invisible or bidirectional Unicode character, such as a zero-width space, a word joiner, an invisible operator, a byte order mark past the start of a file, a bidirectional embedding, override or isolate, a soft hyphen or directional mark outside a locale file or right-to-left text, a tag character outside an emoji flag sequence, or a zero-width joiner or non-joiner outside a non-Latin script or an emoji sequence), INJECTION_PI02 (warn by default: an HTML comment, link title or reference definition added to a Markdown or agent instruction file holds a phrase that addresses an agent), INJECTION_PI03 (warn by default: an added line holds a known prompt-injection phrase of the versioned phrase list or of the org policy's injection.phrases), INJECTION_PI04 (warn by default: a line added to an agent instruction file holds a base64 or hex run of more than 200 characters), INJECTION_PI05 (warn by default: an agent instruction file is added inside a vendored directory such as node_modules, vendor or dist), INJECTION_TEXT_TRUNCATED (warn: some files were too large to scan in full, and the message names up to 5 of them; each of INJECTION_PI01 to INJECTION_PI05 names up to 5 locations as paths and line numbers, and each injection signal a character name and code point, a phrase id or a run length, never file text)";

/** The text appended to the message-code description (no character in it is escaped by JSON). */
export const V070_CODE_TEXT = ` Codes added in v0.7.0: ${V070_INJECTION_TEXT}, ${V070_SETUP_TEXT}, ${V070_EXERCISE_TEXT}.`;

/** The prompt-injection scan's message codes. */
export const V070_INJECTION_CODES = [
  "INJECTION_PI01",
  "INJECTION_PI02",
  "INJECTION_PI03",
  "INJECTION_PI04",
  "INJECTION_PI05",
  "INJECTION_TEXT_TRUNCATED",
];

/** Stale instructions' message codes. */
export const V070_SETUP_CODES = ["SETUP_STALE_SI01", "SETUP_STALE_SI02", "SETUP_STALE_SI03", "SETUP_STALE_SI04"];

/** The message codes the v0.7.0 text names, in code-unit order. */
export const V070_CODES = [...V070_INJECTION_CODES, ...V070_SETUP_CODES, "TESTS_NOT_EXERCISING_CHANGES"];

/** The prompt-injection scan's new top-level report property, after `setupHealth` (with the line break before it). */
export const V070_INJECTION_SCHEMA = `
    "injection": {
      "description": "The prompt-injection surface scan (PI01-PI05): what the lines the change adds carry that targets the next agent reading the repository. Present only when there is at least one finding; a missing object means nothing was found or there was no diff to read.",
      "type": "object",
      "additionalProperties": false,
      "required": ["signals"],
      "properties": {
        "signals": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["id", "severity", "path", "line", "detail"],
            "properties": {
              "id": { "type": "string", "pattern": "^PI[0-9]{2}$" },
              "severity": { "enum": ["block", "warn", "info"] },
              "path": { "type": "string" },
              "line": { "type": ["integer", "null"], "minimum": 1 },
              "detail": { "type": "string", "minLength": 1, "maxLength": 300 }
            }
          }
        }
      }
    },`;

/**
 * A8 step 1's insertion into the `testIntegrity` properties of report.v2.json: the optional `exercise` object, right
 * after `changes`, as the exact bytes the file gains.
 */
export const V070_EXERCISE_SCHEMA_TEXT = `,
        "exercise": {
          "description": "The tests-exercise check (since 0.7.0): the changed JS/TS source files (an added, modified or renamed file with at least one added line; not a test, declaration, config, generated, build-output or coverage-excluded file) that no JS/TS test file the change adds or modifies imports directly with a relative import while keeping or raising its assertion count. Present only when at least one changed source file is not exercised, and then it comes with one TESTS_NOT_EXERCISING_CHANGES warn message; absent when every checked file is exercised, when none was checked, when the mode is off, when the diff is unavailable and when the touched test files were not read.",
          "type": "object",
          "additionalProperties": false,
          "required": ["checked", "notExercised"],
          "properties": {
            "checked": {
              "description": "How many changed source files the check looked at.",
              "type": "integer",
              "minimum": 1
            },
            "notExercised": {
              "description": "Repo-relative paths of the changed source files no changed test file imports, sorted in code-unit order, at most 200.",
              "type": "array",
              "minItems": 1,
              "maxItems": 200,
              "items": { "type": "string", "minLength": 1 }
            },
            "truncated": {
              "description": "How many paths the 200-entry cap left out of notExercised. Absent when none were left out.",
              "type": "integer",
              "minimum": 1
            }
          }
        }`;

/** `text` with `part` taken out; throws unless it appears exactly once. */
function withoutOnce(text: string, part: string, name: string): string {
  const count = text.split(part).length - 1;
  if (count !== 1) throw new Error(`v0.7.0: expected the ${name} once, found ${count}`);
  return text.replace(part, "");
}

/** `text` (report.v2.json or its code description) with the v0.7.0 code text taken out; throws unless it appears once. */
export function withoutV070CodeText(text: string): string {
  return withoutOnce(text, V070_CODE_TEXT, "v0.7.0 code text");
}

/** report.v2.json with the `testIntegrity.exercise` property taken out; throws unless it appears once. */
export function withoutV070ExerciseSchema(text: string): string {
  return withoutOnce(text, V070_EXERCISE_SCHEMA_TEXT, "testIntegrity.exercise schema text");
}

/** Stale instructions' new top-level report property, as report.v2.json spells it (with the line break before it). */
export const V070_SETUP_SCHEMA_TEXT = `
    "setupHealth": {
      "description": "Stale agent instructions (since 0.7.0): instruction files that name a command, path or file the repository does not have. Present only when there is at least one finding, and only for a change that touches the instruction file or removes what it names. At most 20 findings per file and id and 100 in all; the stale-instruction messages count the rest.",
      "type": "object",
      "additionalProperties": false,
      "required": ["stale"],
      "properties": {
        "stale": {
          "type": "array",
          "minItems": 1,
          "maxItems": 100,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["id", "path", "line", "kind"],
            "properties": {
              "id": {
                "description": "SI01 a package-manager script or make target the root package.json or Makefile does not define, SI02 a path in an inline code span that is not tracked, SI03 a file to read (a Markdown link or an @path import) that is not tracked, SI04 an instruction file last changed more than 90 days before HEAD's commit that names a file the change edits.",
                "enum": ["SI01", "SI02", "SI03", "SI04"]
              },
              "path": { "description": "The instruction file, repo-relative.", "type": "string", "minLength": 1 },
              "line": { "type": "integer", "minimum": 1 },
              "kind": { "enum": ["command", "path", "file"] },
              "token": {
                "description": "The command in canonical form (pnpm run build, make test) or the path the instruction names; present only when every character is a repo-path character (letters, digits, . _ - + /, and : @ in a script name) and the path or name is at most 200 or 100 long.",
                "type": "string",
                "minLength": 1,
                "maxLength": 220,
                "pattern": "^[A-Za-z0-9._/+:@ -]+$"
              }
            }
          }
        }
      }
    },`;

/** report.v2.json with the top-level `setupHealth` property taken out; throws unless it appears once. */
export function withoutV070SetupSchema(text: string): string {
  return withoutOnce(text, V070_SETUP_SCHEMA_TEXT, "setupHealth schema text");
}

/** report.v2.json with the top-level `injection` property taken out; throws unless it appears once. */
export function withoutV070InjectionSchema(text: string): string {
  return withoutOnce(text, V070_INJECTION_SCHEMA, "injection schema text");
}

/**
 * report.v2.json with every v0.7.0 property insertion taken out (the `exercise`, `setupHealth` and `injection`
 * properties) while the code text stays; for the pins that cut the appended code texts themselves.
 */
export function withoutV070Properties(text: string): string {
  return withoutV070InjectionSchema(withoutV070SetupSchema(withoutV070ExerciseSchema(text)));
}

/**
 * report.v2.json with every v0.7.0 insertion taken out: the code text and the `exercise`, `setupHealth` and `injection`
 * properties.
 */
export function withoutV070SchemaEdits(text: string): string {
  return withoutV070Properties(withoutV070CodeText(text));
}
