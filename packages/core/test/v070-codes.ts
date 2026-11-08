// v0.7.0 codes. Each v0.7.0 feature adds its own part of the " Codes added in v0.7.0:" sentence that the message-code
// description of report.v2.json gains, after the v0.6.0 sentence (v060-codes.ts). The schema pins that compare
// report.v2.json with an older commit take exactly this text out first (and, with `withoutV070SchemaEdits`, every other
// v0.7.0 schema insertion), so every other byte stays pinned. Features built in parallel add their part here as their
// own named constant; the sentence lists the parts in code-unit order of their codes.

/** A8 step 1 (tests exercise the changed lines)'s part of the v0.7.0 text. */
export const V070_EXERCISE_TEXT =
  "TESTS_NOT_EXERCISING_CHANGES (warn, never an error, at most once per report: changed JS/TS source files that no JS/TS test file the change adds or modifies imports directly with a relative import while keeping or raising its assertion count; the message names the count checked, the count not exercised and up to 10 paths, then +N more, and testIntegrity.exercise lists up to 200 paths, never file text)";

/** The text appended to the message-code description (no character in it is escaped by JSON). */
export const V070_CODE_TEXT = ` Codes added in v0.7.0: ${V070_EXERCISE_TEXT}.`;

/** The message codes the v0.7.0 text names. */
export const V070_CODES = ["TESTS_NOT_EXERCISING_CHANGES"];

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

/** report.v2.json with every v0.7.0 insertion taken out: the code text and the `exercise` property. */
export function withoutV070SchemaEdits(text: string): string {
  return withoutV070ExerciseSchema(withoutV070CodeText(text));
}
