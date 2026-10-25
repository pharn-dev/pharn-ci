import type { TestIntegritySignal } from "../report.js";
import type { TestBlock } from "../testIndex/types.js";
import { bodyTokens } from "./bodyTokens.js";
import type { TestMatch } from "./testMatch.js";
import { droppedAssertionsDetail, emptiedTestDetail, fullTestName, helperTestDetail } from "./testName.js";

/** A call: an optional `this.`, a name and any `.member` chain, then `(`. Not preceded by a word character or a dot. */
const CALL = /(?:^|[^\w$.])((?:this\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;
const HELPER_NAME = /^(expect|assert|check|verify|should|validate|ensure)/i;

/** Whether a head body calls a function whose name suggests an assertion helper. `expect(…)` and `expect.*(…)` do not. */
function callsHelper(body: string): boolean {
  for (const match of body.matchAll(CALL)) {
    const segments = (match[1] as string).split(".");
    if (segments[0] === "expect") continue;
    if (HELPER_NAME.test(segments[segments.length - 1] as string)) return true;
  }
  return false;
}

const MODIFIERS_THAT_EXCUSE = ["skip", "todo", "skipIf", "runIf"] as const;

const ASSERTION_ROOT = /^assert\w*$/;
const isAssertionRoot = (token: string) => token === "expect" || token === "should" || ASSERTION_ROOT.test(token);

/** For each base token, whether the greedy subsequence alignment (from the left or from the right) matched it. */
function align(base: readonly string[], head: readonly string[], fromLeft: boolean): boolean[] | null {
  const matched: boolean[] = new Array<boolean>(base.length).fill(false);
  let at = fromLeft ? 0 : head.length - 1;
  const step = fromLeft ? 1 : -1;
  for (let i = fromLeft ? 0 : base.length - 1; i >= 0 && i < base.length; i += step) {
    if (at < 0 || at >= head.length) break;
    if (base[i] === head[at]) {
      matched[i] = true;
      at += step;
    }
  }
  return at === (fromLeft ? head.length : -1) ? matched : null;
}

/** Whether every maximal run of unmatched base tokens holds an assertion-root token. */
function runsHoldAssertions(base: readonly string[], matched: readonly boolean[]): boolean {
  let hasRoot = false;
  let inRun = false;
  for (let i = 0; i <= base.length; i++) {
    if (i < base.length && matched[i] !== true) {
      inRun = true;
      if (isAssertionRoot(base[i] as string)) hasRoot = true;
    } else if (inRun) {
      if (!hasRoot) return false;
      inRun = false;
      hasRoot = false;
    }
  }
  return true;
}

/**
 * Whether the head body is the base body with only assertion statements taken out: its tokens are a subsequence of the
 * base tokens, found by a greedy alignment from the left or else from the right, and every stretch of base tokens the
 * alignment leaves out holds `expect`, `should` or a token that starts with `assert`.
 */
function restUnchanged(base: TestBlock, head: TestBlock): boolean {
  const baseTokens = bodyTokens(base.body);
  const headTokens = bodyTokens(head.body);
  for (const fromLeft of [true, false]) {
    const matched = align(baseTokens, headTokens, fromLeft);
    if (matched !== null && runsHoldAssertions(baseTokens, matched)) return true;
  }
  return false;
}

/**
 * TI05, a test whose assertions were emptied or dropped. Reads the matched pairs. A pair counts when the base test had
 * assertions and the head test is not marked `skip`, `todo`, `skipIf` or `runIf`:
 * - no assertions at head and no call to an assertion helper in the head body: severity is the mode;
 * - no assertions at head and a helper call: `warn`;
 * - fewer than at base but at least one, with the rest of the body unchanged: `warn`.
 * The path is the head path and the line the head line. The detail is a fixed sentence around the full name.
 */
export function detectTI05(match: Pick<TestMatch, "pairs">, mode: "block" | "warn"): TestIntegritySignal[] {
  const found: TestIntegritySignal[] = [];
  for (const { headPath, base, head } of match.pairs) {
    if (base.assertionCount <= 0) continue;
    if (MODIFIERS_THAT_EXCUSE.some((modifier) => head.modifiers.includes(modifier))) continue;
    const name = fullTestName(head);
    let severity: TestIntegritySignal["severity"] | null = null;
    let detail = "";
    if (head.assertionCount === 0) {
      const helper = callsHelper(head.body);
      severity = helper ? "warn" : mode;
      detail = helper ? helperTestDetail(name, base.assertionCount) : emptiedTestDetail(name, base.assertionCount);
    } else if (head.assertionCount < base.assertionCount && restUnchanged(base, head)) {
      severity = "warn";
      detail = droppedAssertionsDetail(name, base.assertionCount, head.assertionCount);
    }
    if (severity !== null) found.push({ id: "TI05", severity, path: headPath, line: head.line, detail });
  }
  return found;
}
