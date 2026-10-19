import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The targets and the fixtures are loaded inside each test body: these AC tests are written before the strict
// threshold rule and fixtures/threshold-parsing/ exist, so nothing that depends on them may run while the file loads.

const FIXTURES = new URL("../../../fixtures/threshold-parsing/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, FIXTURES), "utf8");

const ERROR = '"coverage.threshold" must be a number between 0 and 100';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The fixture really is a `coverage:` mapping whose `threshold` is written exactly as `raw`. */
function expectThresholdWrittenAs(name: string, text: string, raw: string): void {
  expect(text, name).toMatch(/^coverage:\s*$/m);
  expect(text, name).toMatch(new RegExp(`^[ \\t]+threshold:[ \\t]*${escapeRegExp(raw)}[ \\t]*$`, "m"));
}

/** Every value held at `key`, at any depth of the parsed YAML. */
function valuesAt(node: unknown, key: string): unknown[] {
  if (node === null || typeof node !== "object") return [];
  const found: unknown[] = [];
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === key) found.push(v);
    found.push(...valuesAt(v, key));
  }
  return found;
}

describe("strict coverage.threshold in .pharn/ci.yml", () => {
  it("AC-2: refuses an unquoted 1e2, 5e1, 0x10, +5, .5, 80. and a quoted 1e2 by the text the user wrote", async () => {
    const { ConfigError, parseConfig } = await import("../src/config.js");
    const cases: [string, string][] = [
      ["refuse-1e2.yml", "1e2"],
      ["refuse-5e1.yml", "5e1"],
      ["refuse-0x10.yml", "0x10"],
      ["refuse-plus-5.yml", "+5"],
      ["refuse-dot-5.yml", ".5"],
      ["refuse-80-dot.yml", "80."],
      ["refuse-quoted-1e2.yml", '"1e2"'],
    ];
    for (const [name, raw] of cases) {
      const text = read(name);
      expectThresholdWrittenAs(name, text, raw);
      let thrown: unknown;
      try {
        parseConfig(text);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, name).toBeInstanceOf(ConfigError);
      expect((thrown as Error).message, name).toContain(ERROR);
    }
  });

  it("AC-2: accepts threshold 80, 72.5, 0, 100 and a quoted 80", async () => {
    const { parseConfig } = await import("../src/config.js");
    const cases: [string, string, number][] = [
      ["accept-80.yml", "80", 80],
      ["accept-72.5.yml", "72.5", 72.5],
      ["accept-0.yml", "0", 0],
      ["accept-100.yml", "100", 100],
      ["accept-quoted-80.yml", '"80"', 80],
    ];
    for (const [name, raw, expected] of cases) {
      const text = read(name);
      expectThresholdWrittenAs(name, text, raw);
      expect(parseConfig(text).coverage?.threshold, name).toBe(expected);
    }
  });

  it("AC-2: the generic YAML reader still reads 1e2 as the number 100 for a key other than threshold", async () => {
    const { parseYamlSubset } = await import("../src/config.js");
    const text = read("other-key-1e2.yml");
    const keys = [...text.matchAll(/^[ \t]*([A-Za-z_][\w-]*):[ \t]*1e2[ \t]*$/gm)].map((m) => m[1] as string);
    expect(keys.length, "the other-key fixture must contain an exponent-form number to test").toBeGreaterThan(0);
    expect(keys, "the 1e2 key is not threshold").not.toContain("threshold");
    const parsed = parseYamlSubset(text);
    for (const key of keys) {
      expect(valuesAt(parsed, key), key).toEqual([100]);
    }
  });
});
