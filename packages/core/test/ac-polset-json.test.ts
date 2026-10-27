import { describe, expect, it } from "vitest";

// E3 item 23 (policy settings), AC-1. parseSettingsJson() is loaded inside the test body: the AC test is written
// before the build adds it, so nothing the build adds may run while this file loads.

type JsonValue =
  | { type: "string"; value: string; line: number }
  | { type: "number"; value: number; line: number }
  | { type: "boolean"; value: boolean; line: number }
  | { type: "null"; line: number }
  | { type: "array"; items: JsonValue[]; line: number }
  | { type: "object"; members: Map<string, { keyLine: number; value: JsonValue }>; line: number };
type Result =
  | { ok: true; value: JsonValue; duplicates: { reason: string; line: number }[] }
  | { ok: false; reason: string };
type Parse = (text: string, options: { jsonc: boolean }) => Result;

async function load(): Promise<Parse> {
  const core = (await import("@pharn-ci/core")) as unknown as { parseSettingsJson: Parse };
  expect(typeof core.parseSettingsJson, "parseSettingsJson is exported").toBe("function");
  return core.parseSettingsJson;
}

function ok(result: Result): { value: JsonValue; duplicates: { reason: string; line: number }[] } {
  if (!result.ok) throw new Error(`expected a parse, got ${result.reason}`);
  return result;
}

function member(value: JsonValue | undefined, key: string): { keyLine: number; value: JsonValue } {
  if (value === undefined || value.type !== "object") throw new Error(`not an object at ${key}`);
  const found = value.members.get(key);
  if (found === undefined) throw new Error(`no member ${key}`);
  return found;
}

describe("parseSettingsJson: strict JSON and JSONC with lines", () => {
  it("AC-1: lines, decoded strings, last duplicate wins with each later one reported, __proto__ as a key, comments only under jsonc, and a fixed reason word on failure", async () => {
    const parse = await load();

    const lines = [
      "﻿{", // 1
      '  "a": "\\u0041\\n\\"",', // 2
      '  "nested": {', // 3
      '    "list": [', // 4
      "      1,", // 5
      '      "x",', // 6
      '      { "deep": true }', // 7
      "    ]", // 8
      "  },", // 9
      '  "k": 1,', // 10
      '  "k": 2,', // 11
      '  "k": 3,', // 12
      '  "__proto__": { "polluted": "yes" },', // 13
      '  "later":', // 14
      '    "v"', // 15
      "}", // 16
    ];
    for (const jsonc of [false, true]) {
      const parsed = ok(parse(lines.join("\n"), { jsonc }));
      const root = parsed.value;
      expect(root.type, `jsonc ${jsonc}: the root is an object`).toBe("object");
      expect(root.line, `jsonc ${jsonc}: the BOM is stripped and the root starts on line 1`).toBe(1);

      const a = member(root, "a");
      expect(a.keyLine).toBe(2);
      expect(a.value).toEqual({ type: "string", value: 'A\n"', line: 2 });

      const nested = member(root, "nested");
      expect([nested.keyLine, nested.value.line]).toEqual([3, 3]);
      const list = member(nested.value, "list");
      expect([list.keyLine, list.value.line]).toEqual([4, 4]);
      if (list.value.type !== "array") throw new Error("list is not an array");
      expect(list.value.items.map((item) => [item.type, item.line])).toEqual([
        ["number", 5],
        ["string", 6],
        ["object", 7],
      ]);
      expect(list.value.items[0]).toEqual({ type: "number", value: 1, line: 5 });
      const deep = member(list.value.items[2], "deep");
      expect(deep).toEqual({ keyLine: 7, value: { type: "boolean", value: true, line: 7 } });

      const k = member(root, "k");
      expect(k.value).toEqual({ type: "number", value: 3, line: 12 });
      expect(k.keyLine, "the last occurrence's key line").toBe(12);
      expect(parsed.duplicates, "each later occurrence of k, at its own key line").toEqual([
        { reason: "duplicate-key", line: 11 },
        { reason: "duplicate-key", line: 12 },
      ]);

      const proto = member(root, "__proto__");
      expect(proto.keyLine).toBe(13);
      expect(member(proto.value, "polluted").value).toEqual({ type: "string", value: "yes", line: 13 });
      expect(({} as Record<string, unknown>).polluted, "Object.prototype is untouched").toBeUndefined();
      expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();

      const later = member(root, "later");
      expect([later.keyLine, later.value.line], "a value carries the line of its own first character").toEqual([
        14, 15,
      ]);
    }

    // CRLF counts as one line break.
    const crlf = ok(parse('{\r\n  "a": 1,\r\n  "b": 2\r\n}', { jsonc: false }));
    expect(member(crlf.value, "b").keyLine).toBe(3);

    // Comments and trailing commas: not JSON in strict mode, JSONC accepts them; a block comment advances lines.
    const commented = [
      "{", // 1
      "  // a line comment", // 2
      '  "a": 1, /* a block', // 3
      "  comment */", // 4
      '  "b": [1, 2,],', // 5
      "}", // 6
    ].join("\n");
    expect(parse(commented, { jsonc: false })).toEqual({ ok: false, reason: "not-json" });
    const jsonc = ok(parse(commented, { jsonc: true }));
    expect(member(jsonc.value, "a").keyLine).toBe(3);
    const b = member(jsonc.value, "b");
    expect(b.keyLine, "lines advance inside a block comment").toBe(5);
    if (b.value.type !== "array") throw new Error("b is not an array");
    expect(b.value.items.map((item) => (item.type === "number" ? item.value : null))).toEqual([1, 2]);
    for (const text of ['{"a": 1,}', "[1, 2,]", '{"a": 1} // tail', '/* lead */ {"a": 1}']) {
      expect(parse(text, { jsonc: false }), `strict refuses ${text}`).toEqual({ ok: false, reason: "not-json" });
      expect(parse(text, { jsonc: true }).ok, `jsonc accepts ${text}`).toBe(true);
    }

    // A malformed text returns a fixed reason word, never throws, and holds none of its input.
    const malformed = [
      '{"a": "wombatword"',
      '{"wombatword" 1}',
      "",
      '{"a": tru, "wombatword": 1}',
      '["wombatword"] trailing',
      '{"a": "bad \\q wombatword"}',
      '{"a": "raw \u0001 wombatword"}',
      '{"a": 01}',
      "/* wombatword",
    ];
    for (const text of malformed) {
      for (const jsonc of [false, true]) {
        let result: Result | undefined;
        expect(
          () => {
            result = parse(text, { jsonc });
          },
          `does not throw on ${JSON.stringify(text)}`,
        ).not.toThrow();
        expect(result, `${JSON.stringify(text)} (jsonc ${jsonc})`).toEqual({ ok: false, reason: "not-json" });
        expect(JSON.stringify(result).includes("wombatword"), "no input text in the result").toBe(false);
      }
    }
  });
});
