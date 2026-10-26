import type { TestBlock } from "../testIndex/types.js";

/** A dotted name: identifiers joined by single dots. Each repeat must consume a dot, so it backtracks in linear time. */
const DOTTED = "[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*";

/** The dotted callee called first inside `expect(`, after an optional `await`. */
const EXPECT_SUBJECT = new RegExp(`expect\\(\\s*(?:await\\s+)?(${DOTTED})\\s*\\(`, "g");

/** The dotted callee called right after a Python `assert`, after an optional `await`. */
const ASSERT_SUBJECT = new RegExp(`\\bassert\\s+(?:await\\s+)?(${DOTTED})\\s*\\(`, "g");

/**
 * The subjects of a normalized test body: the dotted names called as the first thing inside `expect(` (after an
 * optional `await`) or right after a Python `assert`. A body that asserts nothing about a call has none.
 */
export function testSubjects(body: string): Set<string> {
  const found = new Set<string>();
  for (const pattern of [EXPECT_SUBJECT, ASSERT_SUBJECT]) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(body); match !== null; match = pattern.exec(body)) found.add(match[1] as string);
  }
  return found;
}

/** The assertion chains a test holds. */
export function assertionChains(block: TestBlock): Set<string> {
  return new Set(block.assertions.map((assertion) => assertion.chain));
}

/** Whether `head` holds every chain of `base`. */
export function holdsEveryChain(base: ReadonlySet<string>, head: ReadonlySet<string>): boolean {
  for (const chain of base) if (!head.has(chain)) return false;
  return true;
}

/** Whether the two sets share an element. */
export function sharesAny(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) if (large.has(item)) return true;
  return false;
}
