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
      ["a flow list", "coverage:\n  exclude: [a, b]\n", "unsupported YAML syntax"],
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
});
