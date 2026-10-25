import { fnv1a32Hex } from "./hash.js";
import { MAX_PYTHON_RAW_ARRAY } from "./pythonTypes.js";
import { cutName, trimBodySpaces } from "./text.js";
import {
  MAX_TEST_BODY_CHARS,
  PYTHON_MOCK_CALLEES,
  TEST_MODIFIER_ORDER,
  type TestAssertion,
  type TestBlock,
  type TestBlockKind,
  type TestIndexRefusalReason,
  type TestIndexResult,
  type TestModifier,
  type TestModuleMock,
} from "./types.js";

type Raw = Record<string, unknown>;

const BLOCK_KINDS: readonly string[] = ["describe", "test", "hook"];
const REFUSAL_REASONS: readonly string[] = ["syntax-error", "too-deep", "too-large", "parser-threw"];
const REFUSED_KEYS: readonly string[] = ["id", "parsed", "reason"];
const PARSED_KEYS: readonly string[] = ["id", "parsed", "normalized", "tests", "mocks"];
const BLOCK_KEYS: readonly string[] = [
  "kind",
  "name",
  "path",
  "line",
  "endLine",
  "modifiers",
  "bodyStart",
  "bodyEnd",
  "assertions",
];
const ASSERTION_KEYS: readonly string[] = ["chain", "line", "awaited", "inTryCatch", "afterEarlyReturn"];
const MOCK_KEYS: readonly string[] = ["callee", "specifier", "line"];

/** A raw output that breaks the format. The detail names an entry and a field and never echoes the output. */
class BadOutput extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(detail);
    this.detail = detail;
  }
}

function isObject(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The object has exactly these keys, all its own (so an own `__proto__` is an extra key). */
function hasExactKeys(value: Raw, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  if (own.length !== keys.length) return false;
  return keys.every((key) => Object.hasOwn(value, key));
}

function bad(where: string, what: string): never {
  throw new BadOutput(`${where}: ${what}`);
}

function checkArray(value: unknown, where: string, field: string): unknown[] {
  if (!Array.isArray(value)) return bad(where, `${field} is not an array`);
  if (value.length > MAX_PYTHON_RAW_ARRAY) return bad(where, `${field} is longer than ${MAX_PYTHON_RAW_ARRAY}`);
  return value;
}

function checkInt(value: unknown, where: string, field: string, min: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return bad(where, `${field} is not an integer`);
  if (value < min) return bad(where, `${field} is below ${min}`);
  return value;
}

function checkString(value: unknown, where: string, field: string): string {
  if (typeof value !== "string") return bad(where, `${field} is not a string`);
  return value;
}

function checkBool(value: unknown, where: string, field: string): boolean {
  if (typeof value !== "boolean") return bad(where, `${field} is not a boolean`);
  return value;
}

function checkKeys(value: unknown, keys: readonly string[], where: string, what: string): Raw {
  if (!isObject(value)) return bad(where, `${what} is not an object`);
  if (!hasExactKeys(value, keys)) return bad(where, `${what} has missing or extra keys`);
  return value;
}

function mapAssertion(value: unknown, where: string): TestAssertion {
  const raw = checkKeys(value, ASSERTION_KEYS, where, "an assertion");
  return {
    chain: checkString(raw.chain, where, "assertion chain"),
    line: checkInt(raw.line, where, "assertion line", 1),
    awaited: checkBool(raw.awaited, where, "assertion awaited"),
    inTryCatch: checkBool(raw.inTryCatch, where, "assertion inTryCatch"),
    afterEarlyReturn: checkBool(raw.afterEarlyReturn, where, "assertion afterEarlyReturn"),
  };
}

function mapBlock(value: unknown, normalized: string, where: string): TestBlock {
  const raw = checkKeys(value, BLOCK_KEYS, where, "a block");
  const kind = checkString(raw.kind, where, "block kind");
  if (!BLOCK_KINDS.includes(kind)) return bad(where, "block kind is unknown");
  const name = checkString(raw.name, where, "block name");
  const path = checkArray(raw.path, where, "block path").map((entry) =>
    cutName(checkString(entry, where, "path entry")),
  );
  const line = checkInt(raw.line, where, "block line", 1);
  const endLine = checkInt(raw.endLine, where, "block endLine", line);
  const modifiers = new Set<string>();
  for (const modifier of checkArray(raw.modifiers, where, "block modifiers")) {
    const text = checkString(modifier, where, "block modifier");
    if (!TEST_MODIFIER_ORDER.includes(text as TestModifier)) return bad(where, "block modifier is unknown");
    modifiers.add(text);
  }
  const bodyStart = checkInt(raw.bodyStart, where, "block bodyStart", 0);
  const bodyEnd = checkInt(raw.bodyEnd, where, "block bodyEnd", bodyStart);
  if (bodyEnd > normalized.length) return bad(where, "block bodyEnd is past the normalized text");
  const assertions = checkArray(raw.assertions, where, "block assertions").map((a) => mapAssertion(a, where));
  const body = trimBodySpaces(normalized.slice(bodyStart, bodyEnd));
  return {
    kind: kind as TestBlockKind,
    name: cutName(name),
    nameDynamic: false,
    path,
    line,
    endLine,
    modifiers: TEST_MODIFIER_ORDER.filter((m) => modifiers.has(m)),
    body: body.length > MAX_TEST_BODY_CHARS ? body.slice(0, MAX_TEST_BODY_CHARS) : body,
    bodyHash: fnv1a32Hex(body),
    assertionCount: assertions.length,
    assertions,
    guards: [],
  };
}

function mapMock(value: unknown, where: string): TestModuleMock {
  const raw = checkKeys(value, MOCK_KEYS, where, "a mock");
  const callee = checkString(raw.callee, where, "mock callee");
  if (!(PYTHON_MOCK_CALLEES as readonly string[]).includes(callee)) return bad(where, "mock callee is unknown");
  const specifier = raw.specifier === null ? null : checkString(raw.specifier, where, "mock specifier");
  return { callee: callee as TestModuleMock["callee"], specifier, line: checkInt(raw.line, where, "mock line", 1) };
}

function mapEntry(value: unknown, index: number): TestIndexResult {
  const where = `entry ${index}`;
  if (!isObject(value)) return bad(where, "is not an object");
  if (value.parsed === false) {
    const raw = checkKeys(value, REFUSED_KEYS, where, "a refused entry");
    if (raw.id !== index) return bad(where, "id is not its position");
    const reason = checkString(raw.reason, where, "refusal reason");
    if (!REFUSAL_REASONS.includes(reason)) return bad(where, "refusal reason is unknown");
    return { parsed: false, reason: reason as TestIndexRefusalReason };
  }
  const raw = checkKeys(value, PARSED_KEYS, where, "a parsed entry");
  if (raw.id !== index) return bad(where, "id is not its position");
  if (raw.parsed !== true) return bad(where, "parsed is not a boolean");
  const normalized = checkString(raw.normalized, where, "normalized");
  const tests = checkArray(raw.tests, where, "tests").map((block, i) =>
    mapBlock(block, normalized, `${where} test ${i}`),
  );
  const mocks = checkArray(raw.mocks, where, "mocks").map((mock, i) => mapMock(mock, `${where} mock ${i}`));
  return { parsed: true, syntaxErrors: 0, tests, mocks };
}

/**
 * Validates the interpreter's raw output strictly and maps it to one `TestIndexResult` per sent file. Anything that
 * breaks the format (non-JSON, a wrong type, an extra or missing key, an out-of-range number, an unknown enum value,
 * ids that are not 0..count-1 in order, an array over 524,288 entries) gives `bad-output` with a fixed one-line detail.
 * Never throws.
 */
export function pythonIndexFromRaw(
  stdout: string,
  count: number,
): { available: true; results: TestIndexResult[] } | { available: false; reason: "bad-output"; detail: string } {
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { available: false, reason: "bad-output", detail: "the output is not valid JSON" };
    }
    const entries = checkArray(parsed, "output", "the top level");
    if (entries.length !== count) return bad("output", "the number of entries is not the number of files sent");
    const results = entries.map((entry, index) => mapEntry(entry, index));
    return { available: true, results };
  } catch (error) {
    const detail = error instanceof BadOutput ? error.detail : "the output could not be read";
    return { available: false, reason: "bad-output", detail };
  }
}
