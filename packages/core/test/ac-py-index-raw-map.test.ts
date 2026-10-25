import { describe, expect, it } from "vitest";

// pythonIndexFromRaw is loaded inside the test body: this test is written before it exists, so nothing the build adds
// may run while the file loads. The raw output follows PLAN.md's "Raw output format"; the expected values are written
// here by hand.

type Mapped = { available: true; results: unknown[] } | { available: false; reason: string; detail: string };
type FromRaw = (stdout: string, count: number) => Mapped;

async function load(): Promise<FromRaw> {
  const core = (await import("@pharn-ci/core")) as unknown as { pythonIndexFromRaw: FromRaw };
  return core.pythonIndexFromRaw;
}

/** 32-bit FNV-1a over UTF-16 code units, as 8 lowercase hex digits (#87's fnv1a32Hex). */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const CLASS_NAME = `Test${"C".repeat(596)}`;
const TEST_NAME = `test_${"n".repeat(595)}`;
const BODY = "assert x == 1 assert y";
const HEAD = `class ${CLASS_NAME}: def ${TEST_NAME}(self):`;
// The body range covers the slice with one leading and one trailing space: " assert x == 1 assert y ".
const NORMALIZED = `${HEAD} ${BODY} x = 2`;
const BODY_START = HEAD.length;
const BODY_END = HEAD.length + 1 + BODY.length + 1;

const ASSERTIONS = [
  { chain: "assert ==", line: 3, awaited: false, inTryCatch: true, afterEarlyReturn: false },
  { chain: "assert truthy", line: 4, awaited: false, inTryCatch: false, afterEarlyReturn: true },
];
const MOCKS = [
  { callee: "mock.patch.object", specifier: "mod.Cls.m", line: 1 },
  { callee: "monkeypatch.setattr", specifier: null, line: 5 },
];

function rawOutput(): string {
  return JSON.stringify([
    { id: 0, parsed: false, reason: "syntax-error" },
    {
      id: 1,
      parsed: true,
      normalized: NORMALIZED,
      tests: [
        {
          kind: "describe",
          name: CLASS_NAME,
          path: [CLASS_NAME],
          line: 1,
          endLine: 5,
          modifiers: [],
          bodyStart: HEAD.indexOf("def"),
          bodyEnd: BODY_END,
          assertions: [],
        },
        {
          kind: "test",
          name: TEST_NAME,
          path: [CLASS_NAME, TEST_NAME],
          line: 2,
          endLine: 4,
          modifiers: ["each", "skipIf", "skip", "fails", "skip", "each", "skipIf"],
          bodyStart: BODY_START,
          bodyEnd: BODY_END,
          assertions: ASSERTIONS,
        },
      ],
      mocks: MOCKS,
    },
  ]);
}

describe("pythonIndexFromRaw: mapping a valid raw output", () => {
  it("AC-18: cuts names and path entries to 500, orders and de-duplicates modifiers, trims and hashes the body, and maps the syntax-error refusal", async () => {
    const fromRaw = await load();
    expect(CLASS_NAME.length).toBe(600);
    expect(TEST_NAME.length).toBe(600);
    expect(NORMALIZED.slice(BODY_START, BODY_END)).toBe(` ${BODY} `);

    const mapped = fromRaw(rawOutput(), 2);
    if (!mapped.available) throw new Error(`expected a mapping, got ${JSON.stringify(mapped)}`);
    expect(mapped.results).toHaveLength(2);

    expect(mapped.results[0]).toStrictEqual({ parsed: false, reason: "syntax-error" });

    const classBody = NORMALIZED.slice(HEAD.indexOf("def"), BODY_END - 1);
    expect(mapped.results[1]).toStrictEqual({
      parsed: true,
      syntaxErrors: 0,
      tests: [
        {
          kind: "describe",
          name: CLASS_NAME.slice(0, 500),
          nameDynamic: false,
          path: [CLASS_NAME.slice(0, 500)],
          line: 1,
          endLine: 5,
          modifiers: [],
          body: classBody,
          bodyHash: fnv1a(classBody),
          assertionCount: 0,
          assertions: [],
          guards: [],
        },
        {
          kind: "test",
          name: TEST_NAME.slice(0, 500),
          nameDynamic: false,
          path: [CLASS_NAME.slice(0, 500), TEST_NAME.slice(0, 500)],
          line: 2,
          endLine: 4,
          // TestModifier order: skip, only, todo, fails, concurrent, each, skipIf, runIf.
          modifiers: ["skip", "fails", "each", "skipIf"],
          body: BODY,
          bodyHash: fnv1a(BODY),
          assertionCount: 2,
          assertions: ASSERTIONS,
          guards: [],
        },
      ],
      mocks: MOCKS,
    });
  });

  it("AC-18: a body longer than 4000 code units is cut to 4000 and hashed in full", async () => {
    const fromRaw = await load();
    const body = Array.from({ length: 600 }, (_, i) => `assert v(${i}) == ${i}`).join(" ");
    expect(body.length).toBeGreaterThan(4000);
    const normalized = `def test_long(): ${body}`;
    const raw = JSON.stringify([
      {
        id: 0,
        parsed: true,
        normalized,
        tests: [
          {
            kind: "test",
            name: "test_long",
            path: ["test_long"],
            line: 1,
            endLine: 601,
            modifiers: [],
            bodyStart: normalized.indexOf("assert") - 1,
            bodyEnd: normalized.length,
            assertions: [],
          },
        ],
        mocks: [],
      },
    ]);

    const mapped = fromRaw(raw, 1);
    if (!mapped.available) throw new Error(`expected a mapping, got ${JSON.stringify(mapped)}`);
    const result = mapped.results[0] as { parsed: true; tests: { body: string; bodyHash: string }[] };
    expect(result.tests[0]?.body).toBe(body.slice(0, 4000));
    expect(result.tests[0]?.bodyHash).toBe(fnv1a(body));
  });
});
