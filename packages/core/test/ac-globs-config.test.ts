import { describe, expect, it } from "vitest";

// The config parser is imported inside the test body, like the other AC tests written before the build.

describe("parseConfig: coverage.file as a string or a list", () => {
  it("AC-10: reads a string, a block list and a flow list in order, and rejects an empty list, bad items and ../*.info", async () => {
    const { ConfigError, parseConfig } = await import("../src/config.js");
    const fileOf = (text: string) => (parseConfig(text) as { coverage?: { file?: unknown } }).coverage?.file;

    expect(fileOf("coverage:\n  file: coverage/lcov.info\n"), "a string").toBe("coverage/lcov.info");

    const block = ["coverage:", "  file:", "    - packages/b/lcov.info", "    - packages/a/coverage.xml", ""].join(
      "\n",
    );
    expect(fileOf(block), "a block list").toEqual(["packages/b/lcov.info", "packages/a/coverage.xml"]);

    const flow = 'coverage:\n  file: [coverage/lcov.info, "packages/*/coverage/lcov.info"]\n';
    expect(fileOf(flow), "a flow list").toEqual(["coverage/lcov.info", "packages/*/coverage/lcov.info"]);

    const rejected: [label: string, text: string][] = [
      ["an empty list", "coverage:\n  file: []\n"],
      ["a number item", "coverage:\n  file:\n    - coverage/lcov.info\n    - 5\n"],
      ["an empty-string item", 'coverage:\n  file:\n    - coverage/lcov.info\n    - ""\n'],
      ["a ../ glob item", 'coverage:\n  file:\n    - "../*.info"\n'],
    ];
    for (const [label, text] of rejected) {
      let error: unknown;
      try {
        parseConfig(text);
      } catch (caught) {
        error = caught;
      }
      expect(error, label).toBeInstanceOf(ConfigError);
      expect((error as Error).message, label).toContain("coverage.file");
    }
  });
});
