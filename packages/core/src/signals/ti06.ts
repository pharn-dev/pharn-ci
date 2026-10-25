import type { TestIntegritySignal } from "../report.js";
import type { TestBlock } from "../testIndex/types.js";
import { type Labelled, labelledAssertions } from "./matcherStrength.js";
import { countTautologies } from "./tautology.js";
import type { TestMatch } from "./testMatch.js";

/** The longest `detail` of a signal, in UTF-16 code units. */
const MAX_DETAIL = 300;
/** How many labels one side of the matcher reason names before ` and N more`. */
const MAX_LABELS = 5;

const MODIFIERS_THAT_EXCUSE = ["skip", "todo", "skipIf", "runIf"] as const;

const TAUTOLOGY_REASON = "an assertion that compares a literal with itself was added";
const TRY_REASON = "an assertion moved into a try block that has a catch";
const RETURN_REASON = "an assertion moved after an early return";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function counts(labels: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const label of labels) map.set(label, (map.get(label) ?? 0) + 1);
  return map;
}

/** The distinct labels `from` holds more of than `other`, sorted by code unit. */
function surplus(from: readonly string[], other: readonly string[]): string[] {
  const own = counts(from);
  const against = counts(other);
  return [...own]
    .filter(([label, n]) => n > (against.get(label) ?? 0))
    .map(([label]) => label)
    .sort(byCodeUnit);
}

function listed(labels: readonly string[], cut: number): string {
  if (labels.length <= cut) return labels.join(", ");
  return `${labels.slice(0, cut).join(", ")} and ${labels.length - cut} more`;
}

/** `<strong> → <weak>` when the head has fewer strong and more weak assertions than the base, else null. */
function matcherReason(base: readonly Labelled[], head: readonly Labelled[]): ((cut: number) => string) | null {
  const strong = (list: readonly Labelled[]) => list.filter((l) => l.strength === "strong").map((l) => l.label);
  const weak = (list: readonly Labelled[]) => list.filter((l) => l.strength === "weak").map((l) => l.label);
  const baseStrong = strong(base);
  const headStrong = strong(head);
  const baseWeak = weak(base);
  const headWeak = weak(head);
  if (!(headStrong.length < baseStrong.length && headWeak.length > baseWeak.length)) return null;
  const lost = surplus(baseStrong, headStrong);
  const gained = surplus(headWeak, baseWeak);
  return (cut) => `${listed(lost, cut)} → ${listed(gained, cut)}`;
}

/** The strength of the guards of a test: 0 with none, null when unknown, else the number of assertions it demands. */
function guardStrength(block: TestBlock): number | null {
  let strength = 0;
  for (const guard of block.guards) {
    if (guard.kind === "assertions") {
      if (guard.count === null) return null;
      strength = Math.max(strength, guard.count);
    } else {
      strength = Math.max(strength, 1);
    }
  }
  return strength;
}

/** The guard reason when the head test demands fewer assertions than the base test did, else null. */
function guardReason(base: TestBlock, head: TestBlock): string | null {
  const before = guardStrength(base);
  const after = guardStrength(head);
  if (before === null || after === null || before <= 0 || after >= before) return null;
  if (head.guards.length === 0) {
    return base.guards.some((g) => g.kind === "assertions")
      ? "expect.assertions removed"
      : "expect.hasAssertions removed";
  }
  return "expect.assertions lowered";
}

const countWhere = (block: TestBlock, pick: (a: TestBlock["assertions"][number]) => boolean) =>
  block.assertions.filter(pick).length;

/** Whether `flag` holds for more of the head test's assertions and fewer without it, than the base test's. */
function movedInto(base: TestBlock, head: TestBlock, flag: "inTryCatch" | "afterEarlyReturn"): boolean {
  const withBase = countWhere(base, (a) => a[flag]);
  const withHead = countWhere(head, (a) => a[flag]);
  const withoutBase = base.assertions.length - withBase;
  const withoutHead = head.assertions.length - withHead;
  return withHead > withBase && withoutHead < withoutBase;
}

/** The weakening reasons of a head test, in the fixed order, each as a function of how many labels the matcher reason names. */
function reasonsOf(base: TestBlock, head: TestBlock, language: "js" | "py"): Array<(cut: number) => string> {
  const reasons: Array<(cut: number) => string> = [];
  const matcher = matcherReason(labelledAssertions(base, language), labelledAssertions(head, language));
  if (matcher !== null) reasons.push(matcher);
  const guard = guardReason(base, head);
  if (guard !== null) reasons.push(() => guard);
  if (countTautologies(head.body, language) > countTautologies(base.body, language))
    reasons.push(() => TAUTOLOGY_REASON);
  if (movedInto(base, head, "inTryCatch")) reasons.push(() => TRY_REASON);
  if (movedInto(base, head, "afterEarlyReturn")) reasons.push(() => RETURN_REASON);
  return reasons;
}

/** The detail: the reasons joined, the matcher reason's label lists cut at five, then four, … until the whole fits. */
function detailOf(reasons: ReadonlyArray<(cut: number) => string>): string {
  let detail = "";
  for (let cut = MAX_LABELS; cut >= 1; cut--) {
    detail = `The test was weakened: ${reasons.map((reason) => reason(cut)).join("; ")}.`;
    if (detail.length <= MAX_DETAIL) return detail;
  }
  return `${detail.slice(0, MAX_DETAIL - 1)}…`;
}

/**
 * TI06, a test that was weakened. Reads the matched pairs (the same-file name pairs and body pairs). A pair counts
 * unless the head test is marked `skip`, `todo`, `skipIf` or `runIf`. Five reasons, joined in this order when they hold:
 * a strong matcher became a weak one, an assertion guard was lowered or removed, an assertion that compares a literal
 * with itself was added, an assertion moved into a try block that has a catch, an assertion moved after an early return.
 * One `warn` finding per pair, at the head path and the head line; the detail is fixed text and matcher labels from a
 * fixed table, never a test name or assertion text.
 */
export function detectTI06(match: Pick<TestMatch, "pairs">): TestIntegritySignal[] {
  const found: TestIntegritySignal[] = [];
  for (const { headPath, base, head } of match.pairs) {
    if (MODIFIERS_THAT_EXCUSE.some((modifier) => head.modifiers.includes(modifier))) continue;
    const reasons = reasonsOf(base, head, headPath.endsWith(".py") ? "py" : "js");
    if (reasons.length === 0) continue;
    found.push({ id: "TI06", severity: "warn", path: headPath, line: head.line, detail: detailOf(reasons) });
  }
  return found;
}
