import { describe, expect, it } from "vitest";

// E3 item 23 (policy settings), AC-2. parseSettingsJson() is loaded inside the test body: the AC test is written
// before the build adds it, so nothing the build adds may run while this file loads.

type JsonValue = { type: string; line: number; value?: unknown; items?: JsonValue[]; members?: Map<string, unknown> };
type Result = { ok: true; value: JsonValue; duplicates: unknown[] } | { ok: false; reason: string };
type Parse = (text: string, options: { jsonc: boolean }) => Result;

async function load(): Promise<Parse> {
  const core = (await import("@pharn-ci/core")) as unknown as { parseSettingsJson: Parse };
  expect(typeof core.parseSettingsJson, "parseSettingsJson is exported").toBe("function");
  return core.parseSettingsJson;
}

const arrays = (depth: number) => `${"[".repeat(depth)}${"]".repeat(depth)}`;
const objects = (depth: number) => `${'{"a":'.repeat(depth - 1)}{}${"}".repeat(depth - 1)}`;

describe("parseSettingsJson: depth and size bounds", { timeout: 60_000 }, () => {
  it("AC-2: 100,000 and 65 nested levels return too-deep, 64 levels parse, and a 512 KiB string parses to its full length", async () => {
    const parse = await load();

    for (const jsonc of [false, true]) {
      expect(parse(arrays(100_000), { jsonc }), "100,000 nested arrays").toEqual({ ok: false, reason: "too-deep" });
      expect(parse(arrays(65), { jsonc }), "65 nested arrays").toEqual({ ok: false, reason: "too-deep" });
      expect(parse(objects(65), { jsonc }), "65 nested objects").toEqual({ ok: false, reason: "too-deep" });
      expect(parse(`{"a": ${arrays(64)}}`, { jsonc }), "an array 64 deep inside an object is 65 levels").toEqual({
        ok: false,
        reason: "too-deep",
      });

      const array64 = parse(arrays(64), { jsonc });
      expect(array64.ok, "64 nested arrays parse").toBe(true);
      let level = array64.ok ? array64.value : undefined;
      let depth = 0;
      while (level !== undefined) {
        expect(level.type).toBe("array");
        depth += 1;
        level = level.items?.[0];
      }
      expect(depth).toBe(64);
      expect(parse(objects(64), { jsonc }).ok, "64 nested objects parse").toBe(true);
    }

    const plain = "a".repeat(512 * 1024);
    const big = parse(`{\n  "s": "${plain}"\n}`, { jsonc: false });
    if (!big.ok) throw new Error(`the 512 KiB string did not parse: ${big.reason}`);
    const member = (value: JsonValue): JsonValue => {
      const found = value.members?.get("s") as { keyLine: number; value: JsonValue } | undefined;
      if (found === undefined) throw new Error("no member s");
      return found.value;
    };
    const s = member(big.value);
    expect(s.type).toBe("string");
    expect(String(s.value).length, "the full length").toBe(512 * 1024);
    expect(s.value === plain).toBe(true);

    // The same size with an escape every 1024 characters decodes to its full length too.
    const run = `${"b".repeat(1022)}\\"`;
    const escaped = parse(`{"s": "${run.repeat(512)}"}`, { jsonc: false });
    if (!escaped.ok) throw new Error(`the escaped string did not parse: ${escaped.reason}`);
    const decoded = String(member(escaped.value).value);
    expect(decoded.length).toBe(1023 * 512);
    expect(decoded.slice(0, 1024)).toBe(`${"b".repeat(1022)}"b`);
  });
});
