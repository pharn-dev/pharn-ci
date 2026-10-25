import { describe, expect, it } from "vitest";

// pythonIndexFromRaw is loaded inside each test body: these tests are written before it exists, so nothing the build
// adds may run while the file loads. The raw outputs follow PLAN.md's "Raw output format": a JSON array with exactly
// `count` entries, entry i having "id": i, each a refused entry (id, parsed: false, reason) or a parsed entry (id,
// parsed: true, normalized, tests, mocks).

type Mapped = { available: true; results: unknown[] } | { available: false; reason: string; detail: string };
type FromRaw = (stdout: string, count: number) => Mapped;

async function load(): Promise<FromRaw> {
  const core = (await import("@pharn-ci/core")) as unknown as { pythonIndexFromRaw: FromRaw };
  return core.pythonIndexFromRaw;
}

/** The longest array the format allows. */
const MAX_ARRAY = 524_288;

const NORMALIZED = "def test_a(): assert x == 1 with patch('os.path'): pass";

type Raw = Record<string, unknown>;

/** A valid two-entry raw output: one parsed file with one test, one assertion and one mock, then one refused file. */
function baseline(): Raw[] {
  const bodyStart = NORMALIZED.indexOf("assert");
  return [
    {
      id: 0,
      parsed: true,
      normalized: NORMALIZED,
      tests: [
        {
          kind: "test",
          name: "test_a",
          path: ["test_a"],
          line: 1,
          endLine: 3,
          modifiers: ["skip"],
          bodyStart,
          bodyEnd: NORMALIZED.length,
          assertions: [{ chain: "assert ==", line: 2, awaited: false, inTryCatch: false, afterEarlyReturn: false }],
        },
      ],
      mocks: [{ callee: "patch", specifier: "os.path", line: 3 }],
    },
    { id: 1, parsed: false, reason: "syntax-error" },
  ];
}

const entry = (raw: Raw[], i: number) => raw[i] as Raw;
const block = (raw: Raw[]) => (entry(raw, 0).tests as Raw[])[0] as Raw;
const assertion = (raw: Raw[]) => (block(raw).assertions as Raw[])[0] as Raw;
const mock = (raw: Raw[]) => (entry(raw, 0).mocks as Raw[])[0] as Raw;

/** A mutation of the baseline: what it changes, and the function that changes it. */
type Mutation = [label: string, mutate: (raw: Raw[]) => void];

const WRONG_TYPES: Mutation[] = [
  ["id as a string", (r) => (entry(r, 0).id = "0")],
  ["id as a fraction", (r) => (entry(r, 0).id = 0.5)],
  ["parsed as a string", (r) => (entry(r, 0).parsed = "true")],
  ["normalized as a number", (r) => (entry(r, 0).normalized = 1)],
  ["tests as an object", (r) => (entry(r, 0).tests = {})],
  ["mocks as null", (r) => (entry(r, 0).mocks = null)],
  ["a block as an array", (r) => ((entry(r, 0).tests as unknown[])[0] = [])],
  ["a block name as a number", (r) => (block(r).name = 1)],
  ["a block path as a string", (r) => (block(r).path = "test_a")],
  ["a block path entry as a number", (r) => (block(r).path = [1])],
  ["a block line as a string", (r) => (block(r).line = "1")],
  ["a block line as a fraction", (r) => (block(r).line = 1.5)],
  ["a block line past the safe integers", (r) => (block(r).line = 2 ** 60)],
  ["a block endLine as null", (r) => (block(r).endLine = null)],
  ["block modifiers as a string", (r) => (block(r).modifiers = "skip")],
  ["a modifier as a number", (r) => (block(r).modifiers = [1])],
  ["a bodyStart as a string", (r) => (block(r).bodyStart = "0")],
  ["a bodyEnd as a boolean", (r) => (block(r).bodyEnd = true)],
  ["block assertions as an object", (r) => (block(r).assertions = {})],
  ["an assertion chain as a number", (r) => (assertion(r).chain = 1)],
  ["an assertion line as a string", (r) => (assertion(r).line = "2")],
  ["an assertion awaited as a string", (r) => (assertion(r).awaited = "false")],
  ["an assertion inTryCatch as a number", (r) => (assertion(r).inTryCatch = 0)],
  ["an assertion afterEarlyReturn as null", (r) => (assertion(r).afterEarlyReturn = null)],
  ["a mock specifier as a number", (r) => (mock(r).specifier = 1)],
  ["a mock line as a string", (r) => (mock(r).line = "3")],
  ["a mock callee as a number", (r) => (mock(r).callee = 1)],
  ["a refusal reason as a number", (r) => (entry(r, 1).reason = 1)],
  ["a refused entry with parsed: true", (r) => (entry(r, 1).parsed = true)],
];

const EXTRA_KEYS: Mutation[] = [
  ["an extra key on a parsed entry", (r) => (entry(r, 0).extra = 1)],
  ["an extra key on a refused entry", (r) => (entry(r, 1).detail = "x")],
  ["an extra key on a block", (r) => (block(r).guards = [])],
  ["an extra key on an assertion", (r) => (assertion(r).column = 4)],
  ["an extra key on a mock", (r) => (mock(r).extra = null)],
  ["a parsed entry carrying a reason", (r) => (entry(r, 0).reason = "syntax-error")],
  ["a refused entry carrying tests", (r) => (entry(r, 1).tests = [])],
];

function without(target: (r: Raw[]) => Raw, key: string): Mutation {
  return [`a missing ${key}`, (r) => delete target(r)[key]];
}

const MISSING_KEYS: Mutation[] = [
  ...["id", "parsed", "normalized", "tests", "mocks"].map((k) => without((r) => entry(r, 0), k)),
  ...["id", "parsed", "reason"].map((k) => without((r) => entry(r, 1), k)),
  ...["kind", "name", "path", "line", "endLine", "modifiers", "bodyStart", "bodyEnd", "assertions"].map((k) =>
    without(block, k),
  ),
  ...["chain", "line", "awaited", "inTryCatch", "afterEarlyReturn"].map((k) => without(assertion, k)),
  ...["callee", "specifier", "line"].map((k) => without(mock, k)),
];

const RANGES: Mutation[] = [
  ["a bodyEnd past the length of normalized", (r) => (block(r).bodyEnd = NORMALIZED.length + 1)],
  ["a bodyStart greater than its bodyEnd", (r) => (block(r).bodyStart = (block(r).bodyEnd as number) + 1)],
  [
    "a bodyStart greater than its bodyEnd, both inside normalized",
    (r) => {
      block(r).bodyStart = 20;
      block(r).bodyEnd = 10;
    },
  ],
  ["a negative bodyStart", (r) => (block(r).bodyStart = -1)],
  ["a block line of 0", (r) => (block(r).line = 0)],
  ["an endLine before its line", (r) => (block(r).endLine = 0)],
  ["an assertion line of 0", (r) => (assertion(r).line = 0)],
  ["a mock line of 0", (r) => (mock(r).line = 0)],
];

const ENUMS: Mutation[] = [
  ["an unknown block kind", (r) => (block(r).kind = "it")],
  ["an unknown modifier", (r) => (block(r).modifiers = ["focus"])],
  ["an unknown refusal reason", (r) => (entry(r, 1).reason = "too-old")],
  ["an unknown mock callee", (r) => (mock(r).callee = "patch.dict")],
  ["another unknown mock callee", (r) => (mock(r).callee = "mock.MagicMock")],
];

const IDS: Mutation[] = [
  [
    "ids out of order",
    (r) => {
      entry(r, 0).id = 1;
      entry(r, 1).id = 0;
    },
  ],
  ["a repeated id", (r) => (entry(r, 1).id = 0)],
  ["an id past the count", (r) => (entry(r, 1).id = 2)],
  ["a missing entry", (r) => r.pop()],
  ["an extra entry", (r) => r.push({ id: 2, parsed: false, reason: "too-large" })],
];

const NOT_AN_ARRAY: string[] = ["{}", "null", '"x"', "1", "true", '{"0":{"id":0}}'];
const NOT_JSON: string[] = ["", "not json", "[1,", "[{id: 0}]", "[]]", "\u0000"];

describe("pythonIndexFromRaw: hostile raw output", () => {
  it("AC-17: the baseline raw output the mutations start from is valid", async () => {
    const fromRaw = await load();
    const mapped = fromRaw(JSON.stringify(baseline()), 2);
    expect(mapped.available, JSON.stringify(mapped)).toBe(true);
  });

  it("AC-17: non-JSON text gives bad-output", async () => {
    const fromRaw = await load();
    for (const text of NOT_JSON) expectBadOutput(fromRaw, text, 2, `non-JSON ${JSON.stringify(text)}`);
  });

  it("AC-17: a top level that is not an array gives bad-output", async () => {
    const fromRaw = await load();
    for (const text of NOT_AN_ARRAY) expectBadOutput(fromRaw, text, 1, `top level ${text}`);
  });

  it.each([
    ["a wrong-typed field", WRONG_TYPES],
    ["an extra key", EXTRA_KEYS],
    ["a missing key", MISSING_KEYS],
    ["an out-of-range offset or line", RANGES],
    ["an unknown block kind, modifier, refusal reason or mock callee", ENUMS],
    ["ids out of order, missing or repeated", IDS],
  ] as [string, Mutation[]][])("AC-17: %s gives bad-output", async (_label, mutations) => {
    const fromRaw = await load();
    expect(mutations.length).toBeGreaterThan(0);
    for (const [label, mutate] of mutations) {
      const raw = baseline();
      mutate(raw);
      expectBadOutput(fromRaw, JSON.stringify(raw), 2, label);
    }
  });

  it("AC-17: an own __proto__ key is an extra key and gives bad-output", async () => {
    const fromRaw = await load();
    const valid = JSON.stringify(baseline());
    // JSON.parse makes "__proto__" an own property; JSON.stringify of an object literal cannot, so splice it in.
    const onEntry = valid.replace('{"id":1,', '{"id":1,"__proto__":{"x":1},');
    const onBlock = valid.replace('{"kind":"test",', '{"__proto__":null,"kind":"test",');
    expect(onEntry).not.toBe(valid);
    expect(onBlock).not.toBe(valid);
    expectBadOutput(fromRaw, onEntry, 2, "__proto__ on a refused entry");
    expectBadOutput(fromRaw, onBlock, 2, "__proto__ on a block");
  });

  it("AC-17: an array longer than 524,288 entries gives bad-output", async () => {
    const fromRaw = await load();
    const over = MAX_ARRAY + 1;

    const entries = Array.from({ length: over }, (_, i) => `{"id":${i},"parsed":false,"reason":"too-large"}`);
    expectBadOutput(fromRaw, `[${entries.join(",")}]`, over, "a top level of 524,289 entries");

    const longPath = baseline();
    block(longPath).path = Array.from({ length: over }, () => "p");
    expectBadOutput(fromRaw, JSON.stringify(longPath), 2, "a path of 524,289 entries");

    const longModifiers = baseline();
    block(longModifiers).modifiers = Array.from({ length: over }, () => "skip");
    expectBadOutput(fromRaw, JSON.stringify(longModifiers), 2, "modifiers of 524,289 entries");

    const longAssertions = baseline();
    block(longAssertions).assertions = Array.from({ length: over }, () => 0);
    expectBadOutput(fromRaw, JSON.stringify(longAssertions), 2, "assertions of 524,289 entries");

    const longMocks = baseline();
    entry(longMocks, 0).mocks = Array.from({ length: over }, () => 0);
    expectBadOutput(fromRaw, JSON.stringify(longMocks), 2, "mocks of 524,289 entries");
  }, 120_000);
});

function expectBadOutput(fromRaw: FromRaw, stdout: string, count: number, label: string): void {
  let mapped: Mapped;
  try {
    mapped = fromRaw(stdout, count);
  } catch (error) {
    throw new Error(`${label}: pythonIndexFromRaw threw ${String(error)}`);
  }
  expect(mapped.available, `${label}: ${JSON.stringify(mapped).slice(0, 300)}`).toBe(false);
  if (mapped.available) return;
  expect(mapped.reason, label).toBe("bad-output");
  expect(typeof mapped.detail, label).toBe("string");
  expect(Object.keys(mapped).sort(), label).toEqual(["available", "detail", "reason"]);
}
