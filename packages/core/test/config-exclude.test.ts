import { describe, expect, it } from "vitest";

// parseConfig is imported inside each test body, like the other AC tests written before the build: the
// coverage.exclude list does not exist yet, and nothing that depends on it may run while the file loads.

describe("parseConfig: coverage.exclude", () => {
  it("AC-5: reads coverage.exclude as a block list of quoted and plain strings, in order", async () => {
    const { parseConfig } = await import("../src/config.js");

    const deeper = [
      "coverage:",
      "  file: coverage/lcov.info",
      "  exclude:",
      '    - "src/generated/**" # double-quoted',
      "    - 'vendor/**'",
      "    - docs/api/*.md  # plain",
      "  threshold: 80",
      "",
    ].join("\n");
    expect(parseConfig(deeper)).toEqual({
      coverage: {
        file: "coverage/lcov.info",
        exclude: ["src/generated/**", "vendor/**", "docs/api/*.md"],
        threshold: 80,
      },
    });

    const atKeyColumn = [
      "coverage:",
      "  exclude:",
      '  - "*.gen.ts"',
      "  - 'lib/**/fixtures/**' # single-quoted",
      "  - src/a?.ts",
      "  format: lcov",
      "",
    ].join("\n");
    expect(parseConfig(atKeyColumn)).toEqual({
      coverage: { exclude: ["*.gen.ts", "lib/**/fixtures/**", "src/a?.ts"], format: "lcov" },
    });

    const empty = parseConfig("coverage:\n  threshold: 50\n  exclude:\n");
    expect(empty).toEqual({ coverage: { threshold: 50 } });
    expect(empty.coverage).not.toHaveProperty("exclude");
  });

  it("AC-6: rejects coverage.exclude values that are not a list of valid glob strings", async () => {
    const { ConfigError, parseConfig } = await import("../src/config.js");
    const cases: [label: string, text: string, message: string | null][] = [
      ["a scalar string", "coverage:\n  exclude: src/**\n", null],
      ["a number item", "coverage:\n  exclude:\n    - 5\n", null],
      ["a key: value mapping item", "coverage:\n  exclude:\n    - key: value\n", null],
      ["an empty-string item", 'coverage:\n  exclude:\n    - ""\n', null],
      ["an unquoted item starting with *", "coverage:\n  exclude:\n    - *.ts\n", "unsupported YAML syntax"],
      ["a rejected pattern", 'coverage:\n  exclude:\n    - "{a,b}.ts"\n', "{a,b}.ts"],
      // A one-line flow list of scalars is read since F-32 (see AC-F32-1); nested ones are still rejected.
      ["a nested flow list", "coverage:\n  exclude: [a, [b]]\n", "use a block list"],
      ["a list elsewhere", "coverage:\n  - file: x\n", "lists are not supported"],
    ];
    for (const [label, text, message] of cases) {
      let error: unknown;
      try {
        parseConfig(text);
      } catch (e) {
        error = e;
      }
      expect(error, label).toBeInstanceOf(ConfigError);
      if (message !== null) expect((error as Error).message, label).toContain(message);
    }
  });

  it("AC-7: parses 100,000 items and a 100,000-character pattern in linear time", async () => {
    const { parseConfig } = await import("../src/config.js");

    const items = Array.from({ length: 100_000 }, (_, i) => `src/f${i}/**`);
    const many = `coverage:\n  exclude:\n${items.map((item) => `    - ${item}\n`).join("")}`;
    let start = performance.now();
    const manyConfig = parseConfig(many);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(manyConfig.coverage?.exclude).toEqual(items);

    const long = `${"a/".repeat(49_999)}bb`;
    expect(long.length).toBe(100_000);
    start = performance.now();
    const longConfig = parseConfig(`coverage:\n  exclude:\n    - ${long}\n`);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(longConfig.coverage?.exclude).toEqual([long]);
  });

  it("AC-F32-1: reads coverage.exclude as a one-line flow list of quoted and plain strings", async () => {
    const { parseConfig } = await import("../src/config.js");

    expect(parseConfig('coverage:\n  exclude: ["**"]\n')).toEqual({ coverage: { exclude: ["**"] } });
    expect(
      parseConfig(
        'coverage:\n  exclude: [ "dist/**", \'vendor/**\' , docs/api/*.md, "a, b/c.ts" ] # flow\n  threshold: 80\n',
      ),
    ).toEqual({ coverage: { exclude: ["dist/**", "vendor/**", "docs/api/*.md", "a, b/c.ts"], threshold: 80 } });
    // One trailing comma is allowed, an apostrophe inside a plain item is text, and [] is an empty list.
    expect(parseConfig("coverage:\n  exclude: [src/it's/**, b/**,]\n")).toEqual({
      coverage: { exclude: ["src/it's/**", "b/**"] },
    });
    expect(parseConfig("coverage:\n  exclude: []\n")).toEqual({ coverage: { exclude: [] } });

    // Brackets, commas and escaped quotes inside quotes are text to the parser (the glob check rejects
    // "]" afterwards, so this goes through the YAML layer only).
    const { parseYamlSubset } = await import("../src/config.js");
    expect(parseYamlSubset('coverage:\n  exclude: ["x]", \'y, z\', "q\\"r"]\n')).toEqual({
      coverage: { exclude: ["x]", "y, z", 'q"r'] },
    });
  });

  it("AC-F32-2: rejects unsupported flow lists with an error that names the fix", async () => {
    const { ConfigError, parseConfig } = await import("../src/config.js");
    const cases: [label: string, text: string, message: string][] = [
      [
        "a multi-line flow list",
        "coverage:\n  exclude: [a,\n    b]\n",
        'must end with "]" on the same line; use a block list',
      ],
      ["a nested flow mapping", "coverage:\n  exclude: [{a: b}]\n", "nested collections are not supported"],
      ["an empty item", "coverage:\n  exclude: [a, , b]\n", "remove the extra comma"],
      ["text after the list", "coverage:\n  exclude: [a] b\n", 'unexpected text after the flow list "]"'],
      ["a mapping item", "coverage:\n  exclude: [a: b]\n", "quote the item if it is a pattern"],
      ["an unquoted * item", "coverage:\n  exclude: [*.ts]\n", 'quote the value, e.g. "*.gen.ts"'],
      ["a number item", "coverage:\n  exclude: [5]\n", '"coverage.exclude" items must be non-empty strings'],
      ["a rejected pattern", 'coverage:\n  exclude: ["{a,b}.ts"]\n', "{a,b}.ts"],
      ["a flow list elsewhere", "coverage:\n  format: [a]\n", "except as the value of coverage.exclude"],
      ["a top-level flow list", "coverage: [a]\n", "except as the value of coverage.exclude"],
    ];
    for (const [label, text, message] of cases) {
      let error: unknown;
      try {
        parseConfig(text);
      } catch (e) {
        error = e;
      }
      expect(error, label).toBeInstanceOf(ConfigError);
      expect((error as Error).message, label).toContain(message);
    }
  });

  it("AC-F32-3: parses hostile flow lists in linear time", async () => {
    const { ConfigError, parseConfig } = await import("../src/config.js");
    const n = 100_000;

    const items = Array.from({ length: n }, (_, i) => `"src/f${i}/**"`);
    let start = performance.now();
    expect(parseConfig(`coverage:\n  exclude: [${items.join(", ")}]\n`).coverage?.exclude).toHaveLength(n);
    expect(performance.now() - start).toBeLessThan(1000);

    for (const hostile of [`[${'"'.repeat(n)}`, `[${"\\".repeat(n)}`, `["${"\\".repeat(n)}`, `[${",".repeat(n)}]`]) {
      start = performance.now();
      expect(() => parseConfig(`coverage:\n  exclude: ${hostile}\n`)).toThrow(ConfigError);
      expect(performance.now() - start).toBeLessThan(1000);
    }
  });
});
