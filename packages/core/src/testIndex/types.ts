/** The longest test file text (in UTF-16 code units) the test index parses; longer text is refused as `too-large`. */
export const MAX_TEST_INDEX_CHARS = 524_288;
/** The most syntax errors the test index tolerates; more are refused as `syntax-error-heavy`. */
export const MAX_TEST_INDEX_SYNTAX_ERRORS = 10;
/** The deepest syntax tree node the test index walks; deeper is refused as `too-deep`. */
export const MAX_TEST_INDEX_DEPTH = 1000;
/** The longest block name, and the longest path entry, in UTF-16 code units. */
export const MAX_TEST_NAME_CHARS = 500;
/** The longest `body`, in UTF-16 code units. The `bodyHash` covers the full, uncut body. */
export const MAX_TEST_BODY_CHARS = 4000;

/** The kind of a test block: a group, a test or a setup/teardown hook. */
export type TestBlockKind = "describe" | "test" | "hook";

/** A modifier a block carries, listed in this order. */
export type TestModifier = "skip" | "only" | "todo" | "fails" | "concurrent" | "each" | "skipIf" | "runIf";

/** The order modifiers are listed in. */
export const TEST_MODIFIER_ORDER: readonly TestModifier[] = [
  "skip",
  "only",
  "todo",
  "fails",
  "concurrent",
  "each",
  "skipIf",
  "runIf",
];

/** One assertion chain inside a block, written from its root with `.name` per property and `()` per call. */
export interface TestAssertion {
  chain: string;
  line: number;
  /** The chain is the operand of an `await`. */
  awaited: boolean;
  /** The chain sits in the `try` block of a try statement that has a `catch` clause. */
  inTryCatch: boolean;
  /** A `return` statement in the same function ends before the chain starts. */
  afterEarlyReturn: boolean;
}

/** An `expect.assertions(n)` or `expect.hasAssertions()` call. It is not an assertion. */
export interface TestAssertionGuard {
  kind: "assertions" | "hasAssertions";
  /** The numeric literal argument of `expect.assertions`, else `null`. */
  count: number | null;
  line: number;
}

/** One `describe`, `it`, `test` or hook call of a test file. */
export interface TestBlock {
  kind: TestBlockKind;
  name: string;
  /** The name is not a plain string: a template with substitutions, an `.each` or `.for` name, or any other expression. */
  nameDynamic: boolean;
  /** The names of the enclosing blocks, outermost first, then this block's own name. */
  path: string[];
  line: number;
  endLine: number;
  modifiers: TestModifier[];
  /** The callback body with comments out and whitespace collapsed, cut to 4000 code units. */
  body: string;
  /** 32-bit FNV-1a of the full normalized body, as 8 lowercase hex digits. */
  bodyHash: string;
  assertionCount: number;
  assertions: TestAssertion[];
  guards: TestAssertionGuard[];
}

/** The callees of the Python mock calls the Python test index records. */
export const PYTHON_MOCK_CALLEES = [
  "patch",
  "mock.patch",
  "unittest.mock.patch",
  "mocker.patch",
  "patch.object",
  "mock.patch.object",
  "unittest.mock.patch.object",
  "mocker.patch.object",
  "monkeypatch.setattr",
] as const;

/**
 * A `vi.mock`, `vi.doMock`, `jest.mock` or `jest.doMock` call, or one of the Python mock calls (`patch`,
 * `mock.patch`, `unittest.mock.patch`, `mocker.patch`, their `.object` forms and `monkeypatch.setattr`).
 */
export interface TestModuleMock {
  callee:
    | "vi.mock"
    | "vi.doMock"
    | "jest.mock"
    | "jest.doMock"
    | "patch"
    | "mock.patch"
    | "unittest.mock.patch"
    | "mocker.patch"
    | "patch.object"
    | "mock.patch.object"
    | "unittest.mock.patch.object"
    | "mocker.patch.object"
    | "monkeypatch.setattr";
  /** The module specifier when it is a string literal (or a dynamic import of one), else `null`. For the Python forms, the patch target. */
  specifier: string | null;
  line: number;
}

/** A parsed test file. Plain data: no `undefined`, class instance or cycle. */
export interface TestIndex {
  parsed: true;
  syntaxErrors: number;
  tests: TestBlock[];
  mocks: TestModuleMock[];
}

/** Why a test file was not indexed. */
export type TestIndexRefusalReason = "syntax-error-heavy" | "syntax-error" | "too-large" | "too-deep" | "parser-threw";

export interface TestIndexRefusal {
  parsed: false;
  reason: TestIndexRefusalReason;
}

export type TestIndexResult = TestIndex | TestIndexRefusal;
