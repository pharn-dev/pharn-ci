import { MAX_TEST_BODY_CHARS, type TestBlock } from "../testIndex/types.js";
import { type ArgumentMatcher, type MatcherCall, readMatcherCalls } from "./callArguments.js";
import { type EqualityCall, type EqualityMatcher, readEqualityCalls } from "./expectSubjects.js";

/** The strength of an assertion: strong, weak, and a label to name it by. Neutral assertions are not listed. */
export interface Labelled {
  strength: "strong" | "weak";
  label: string;
}

export type AssertionLanguage = "js" | "py";

/** `expect…` matchers that check a specific value. */
const STRONG_MATCHERS: ReadonlySet<string> = new Set([
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toMatchObject",
  "toContain",
  "toContainEqual",
  "toHaveLength",
  "toMatch",
  "toBeCloseTo",
  "toHaveBeenCalledWith",
  "toHaveBeenLastCalledWith",
  "toHaveBeenNthCalledWith",
  "toHaveBeenCalledTimes",
  "toBeCalledWith",
  "toBeCalledTimes",
  "toHaveText",
  "toHaveValue",
  "toHaveURL",
]);

/** `expect…` matchers that only check that something happened or exists. */
const WEAK_MATCHERS: ReadonlySet<string> = new Set([
  "toBeTruthy",
  "toBeFalsy",
  "toBeDefined",
  "toBeCalled",
  "toHaveBeenCalled",
  "toBeTypeOf",
]);

/** Matchers that are weak under `.not` (the label is `not.<matcher>`). */
const WEAK_NEGATED: ReadonlySet<string> = new Set([
  "toBeNull",
  "toBeUndefined",
  "toBeTruthy",
  "toBeFalsy",
  "toThrow",
  "toThrowError",
]);

const ARGUMENT_SET: ReadonlySet<string> = new Set(["toThrow", "toThrowError", "toHaveProperty", "toBeInstanceOf"]);

const NODE_ASSERT_STRONG: ReadonlySet<string> = new Set([
  "equal",
  "strictEqual",
  "deepEqual",
  "deepStrictEqual",
  "match",
]);

const PYTHON_ASSERT_STRONG: ReadonlySet<string> = new Set([
  "assert ==",
  "assert !=",
  "assert is",
  "assert is None",
  "assert in",
  "assert isinstance",
  "assert approx",
]);
const PYTHON_ASSERT_WEAK: ReadonlySet<string> = new Set(["assert truthy", "assert not", "assert is not None"]);
const PYTHON_METHOD_STRONG: ReadonlySet<string> = new Set([
  "assertEqual",
  "assertEquals",
  "assertNotEqual",
  "assertIn",
  "assertIsInstance",
  "assertWarns",
  "assertAlmostEqual",
  "assertDictEqual",
  "assertListEqual",
  "assertSetEqual",
  "assertTupleEqual",
  "assertSequenceEqual",
  "assertMultiLineEqual",
  "assertCountEqual",
  "assertIs",
  "assertIsNone",
  "assertRaises",
  "assertRaisesRegex",
  "assertRegex",
]);
const PYTHON_METHOD_WEAK: ReadonlySet<string> = new Set(["assertTrue", "assertFalse", "assertIsNotNone"]);

const NODE_ASSERT_ID = /^[A-Za-z_$][\w$]*\.assert\.([A-Za-z]+)\(\)$/;

/** The matcher and `.not` of an `expect…` chain, or null when the chain does not end in `.<name>()`. */
function expectMatcher(chain: string): { matcher: string; negated: boolean } | null {
  const callAt = chain.indexOf("()");
  if (callAt === -1) return null;
  const rest = chain.slice(callAt + 2);
  if (!rest.startsWith(".") || !rest.endsWith("()")) return null;
  const path = rest.slice(1, -2);
  if (path.includes("(")) return null;
  const segments = path.split(".");
  const matcher = segments[segments.length - 1] as string;
  if (matcher === "") return null;
  return { matcher, negated: segments.slice(0, -1).includes("not") };
}

function nodeAssert(chain: string): Labelled | null {
  if (chain === "assert()") return { strength: "weak", label: "assert()" };
  let method: string | undefined;
  if (chain.startsWith("assert.") && chain.endsWith("()")) {
    const name = chain.slice("assert.".length, -2);
    if (/^[A-Za-z]+$/.test(name)) method = name;
  } else {
    method = NODE_ASSERT_ID.exec(chain)?.[1];
  }
  if (method === undefined) return null;
  if (method === "ok") return { strength: "weak", label: "assert.ok" };
  if (NODE_ASSERT_STRONG.has(method)) return { strength: "strong", label: `assert.${method}` };
  return null;
}

function pythonAssertion(chain: string): Labelled | null {
  if (PYTHON_ASSERT_STRONG.has(chain)) return { strength: "strong", label: chain };
  if (PYTHON_ASSERT_WEAK.has(chain)) return { strength: "weak", label: chain };
  if (chain === "pytest.raises()") return { strength: "strong", label: "pytest.raises" };
  if (chain.startsWith("self.") && chain.endsWith("()")) {
    const method = chain.slice("self.".length, -2);
    if (PYTHON_METHOD_STRONG.has(method)) return { strength: "strong", label: method };
    if (PYTHON_METHOD_WEAK.has(method)) return { strength: "weak", label: method };
  }
  return null;
}

/** The strength of an `expect…` matcher whose arguments matter, from the call read from the body (null: neutral). */
function argumentStrength(matcher: ArgumentMatcher, call: MatcherCall | undefined): Labelled | null {
  if (call === undefined) return null;
  if (matcher === "toThrow" || matcher === "toThrowError") {
    return call.args >= 1
      ? { strength: "strong", label: `${matcher}(error)` }
      : { strength: "weak", label: `${matcher}()` };
  }
  if (matcher === "toHaveProperty") {
    return call.args >= 2 ? { strength: "strong", label: "toHaveProperty(key, value)" } : null;
  }
  return call.args === 1 && call.firstArgument === "Object"
    ? { strength: "weak", label: "toBeInstanceOf(Object)" }
    : null;
}

const EQUALITY_SET: ReadonlySet<string> = new Set(["toBe", "toEqual", "toStrictEqual"]);
const INSTANCEOF_SUBJECT = /\sinstanceof\s+([A-Za-z_$][\w$.]*)$/;
const QUOTED_STRING = /^(["'`]).*\1$/s;

/**
 * The strength of a `toBe`, `toEqual` or `toStrictEqual` call that stands for a matcher of its own, read from the subject
 * of its `expect(…)` and its first argument (null: neutral). Six shapes are equivalent to another matcher: `typeof x`
 * against a string is `toBeTypeOf` (weak); `x instanceof Y` against `true` is `toBeInstanceOf(Y)` (neutral, and weak for
 * `Object`); `x.length` is `toHaveLength` (strong); `!!x` or `Boolean(x)` against `true` or `false` is `toBeTruthy` or
 * `toBeFalsy` (weak); `x !== null` against `true` and `x === null` against `false` are `not.toBeNull` (weak); and
 * `x !== undefined` against `true` and `x === undefined` against `false` are `toBeDefined` (weak). Anything else keeps
 * the strong label of the matcher. The subject is read by its text head and tail, not parsed.
 */
function equalityStrength(matcher: EqualityMatcher, call: EqualityCall): Labelled | null {
  const strong: Labelled = { strength: "strong", label: matcher };
  const subject = call.subject;
  if (subject === null) return strong;
  const { head, tail } = subject;
  const argument = call.firstArgument;
  if (head.startsWith("typeof ") && QUOTED_STRING.test(argument)) return { strength: "weak", label: "toBeTypeOf" };
  const instance = argument === "true" ? INSTANCEOF_SUBJECT.exec(tail) : null;
  if (instance !== null) {
    return instance[1] === "Object" ? { strength: "weak", label: "toBeInstanceOf(Object)" } : null;
  }
  if (tail.endsWith(".length")) return { strength: "strong", label: "toHaveLength" };
  if (head.startsWith("!!") || (head.startsWith("Boolean(") && tail.endsWith(")"))) {
    if (argument === "true") return { strength: "weak", label: "toBeTruthy" };
    if (argument === "false") return { strength: "weak", label: "toBeFalsy" };
    return strong;
  }
  if ((tail.endsWith("!== null") && argument === "true") || (tail.endsWith("=== null") && argument === "false")) {
    return { strength: "weak", label: "not.toBeNull" };
  }
  if (
    (tail.endsWith("!== undefined") && argument === "true") ||
    (tail.endsWith("=== undefined") && argument === "false")
  ) {
    return { strength: "weak", label: "toBeDefined" };
  }
  return strong;
}

/**
 * The strong and weak assertions of a test with a label each; neutral assertions are left out. JavaScript and TypeScript
 * chains are classified from the chain the index wrote; the four matchers that need their arguments (`toThrow`,
 * `toThrowError`, `toHaveProperty`, `toBeInstanceOf`) read them from the normalized body, the i-th chain of a matcher
 * taking the i-th call of it in body order (assertions taken in line order). The same holds for `toBe`, `toEqual` and
 * `toStrictEqual`, which are classified by the subject of their `expect(…)` (see `equalityStrength`); a chain with no
 * i-th call is neutral when the body was cut at the index's bound (the chain lies past it) and keeps its strong label
 * otherwise. Python chains come from the Python index.
 */
export function labelledAssertions(block: TestBlock, language: AssertionLanguage): Labelled[] {
  const found: Labelled[] = [];
  if (language === "py") {
    for (const assertion of block.assertions) {
      const labelled = pythonAssertion(assertion.chain);
      if (labelled !== null) found.push(labelled);
    }
    return found;
  }
  const ordered = block.assertions.map((assertion, index) => ({ assertion, index }));
  ordered.sort((a, b) => a.assertion.line - b.assertion.line || a.index - b.index);
  let calls: Map<ArgumentMatcher, MatcherCall[]> | null = null;
  const taken = new Map<ArgumentMatcher, number>();
  let equalities: Map<EqualityMatcher, EqualityCall[]> | null = null;
  const takenEquality = new Map<EqualityMatcher, number>();
  for (const { assertion } of ordered) {
    const chain = assertion.chain;
    if (chain.startsWith("expect")) {
      const parsed = expectMatcher(chain);
      if (parsed === null) continue;
      const { matcher, negated } = parsed;
      if (negated) {
        if (WEAK_NEGATED.has(matcher)) found.push({ strength: "weak", label: `not.${matcher}` });
      } else if (ARGUMENT_SET.has(matcher)) {
        if (calls === null) {
          calls = new Map();
          if (block.body.includes(".to")) {
            for (const call of readMatcherCalls(block.body)) {
              const list = calls.get(call.matcher);
              if (list === undefined) calls.set(call.matcher, [call]);
              else list.push(call);
            }
          }
        }
        const name = matcher as ArgumentMatcher;
        const at = taken.get(name) ?? 0;
        taken.set(name, at + 1);
        const labelled = argumentStrength(name, calls.get(name)?.[at]);
        if (labelled !== null) found.push(labelled);
      } else if (EQUALITY_SET.has(matcher)) {
        if (equalities === null) {
          equalities = new Map();
          if (block.body.includes(".to")) {
            for (const call of readEqualityCalls(block.body)) {
              const list = equalities.get(call.matcher);
              if (list === undefined) equalities.set(call.matcher, [call]);
              else list.push(call);
            }
          }
        }
        const name = matcher as EqualityMatcher;
        const at = takenEquality.get(name) ?? 0;
        takenEquality.set(name, at + 1);
        const call = equalities.get(name)?.[at];
        if (call !== undefined) {
          const labelled = equalityStrength(name, call);
          if (labelled !== null) found.push(labelled);
        } else if (block.body.length < MAX_TEST_BODY_CHARS) {
          found.push({ strength: "strong", label: matcher });
        }
      } else if (STRONG_MATCHERS.has(matcher)) {
        found.push({ strength: "strong", label: matcher });
      } else if (WEAK_MATCHERS.has(matcher)) {
        found.push({ strength: "weak", label: matcher });
      }
    } else if (chain.startsWith("assert") || chain.includes(".assert.")) {
      const labelled = nodeAssert(chain);
      if (labelled !== null) found.push(labelled);
    }
  }
  return found;
}
