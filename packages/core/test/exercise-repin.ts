// A8 step 1 (tests exercise the changed lines) re-pins the tests that compare a report made WITH test sources to a
// committed golden made without them: with sources, check() now also runs the tests-exercise check, so a golden whose
// diff changes a JS/TS source file that no changed test imports gains exactly one TESTS_NOT_EXERCISING_CHANGES warn
// message and testIntegrity.exercise (and a pass verdict becomes warn). The re-pinned tests take exactly that out with
// `withoutExerciseCheck` and compare the rest byte for byte, so nothing else may change.

/** The code the tests-exercise check adds. */
export const EXERCISE_CODE = "TESTS_NOT_EXERCISING_CHANGES";

type Message = { level: string; code: string };
type ReportLike = { verdict: string; messages: Message[]; testIntegrity?: Record<string, unknown> };

/** The `TESTS_NOT_EXERCISING_CHANGES` messages of a report. */
export function exerciseMessages(report: unknown): Message[] {
  return (report as ReportLike).messages.filter((message) => message.code === EXERCISE_CODE);
}

/**
 * A copy of `report` as check() gave it before A8 step 1: without the `TESTS_NOT_EXERCISING_CHANGES` messages and
 * `testIntegrity.exercise`, and with the verdict worked out again from the other messages (fail on an error, warn on a
 * warn, else pass). Every other key keeps its value and its place.
 */
export function withoutExerciseCheck<T>(report: T): T {
  const copy = structuredClone(report) as unknown as ReportLike;
  copy.messages = copy.messages.filter((message) => message.code !== EXERCISE_CODE);
  if (copy.testIntegrity !== undefined) delete copy.testIntegrity.exercise;
  copy.verdict = copy.messages.some((m) => m.level === "error")
    ? "fail"
    : copy.messages.some((m) => m.level === "warn")
      ? "warn"
      : "pass";
  return copy as unknown as T;
}
