import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// The config parser and the fixtures are loaded inside the test body: the AC tests are written before setup.expect
// and fixtures/setup-expect/ exist, so nothing that depends on them may run while the file loads.

/** The fixed agent tool list, as the SPEC names it. */
const AGENT_TOOLS = [
  "claude-code",
  "cursor",
  "copilot",
  "codex",
  "gemini",
  "windsurf",
  "cline",
  "mcp",
  "aider",
  "amazon-q",
  "amp",
  "augment",
  "continue",
  "goose",
  "jules",
  "junie",
  "kiro",
  "opencode",
  "roo",
  "zed",
];

describe("parseConfig: setup.expect rejections", () => {
  it("AC-2: rejects a scalar, an empty or non-string item, an unknown tool name and a list under another key with a ConfigError", async () => {
    const { ConfigError, parseConfig } = await import("../src/config.js");

    function errorOf(label: string, text: string): string {
      let thrown: unknown;
      try {
        parseConfig(text);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, label).toBeInstanceOf(ConfigError);
      return (thrown as Error).message;
    }

    // Not a list.
    for (const [label, text] of [
      ["ci-scalar.yml", fixture("setup-expect/ci-scalar.yml")],
      ["inline scalar", "setup:\n  expect: cursor\n"],
    ] as const) {
      expect(errorOf(label, text), label).toContain('"setup.expect" must be a list of agent tool names');
    }

    // An item that is empty or not a string.
    for (const [label, text] of [
      ["ci-empty-item.yml", fixture("setup-expect/ci-empty-item.yml")],
      ["ci-number-item.yml", fixture("setup-expect/ci-number-item.yml")],
      ["inline empty item", 'setup:\n  expect:\n    - cursor\n    - ""\n'],
      ["inline number item", "setup:\n  expect:\n    - cursor\n    - 1\n"],
    ] as const) {
      expect(errorOf(label, text), label).toContain('"setup.expect" items must be non-empty strings');
    }

    // An unknown name, compared exactly (case-sensitive): quoted, with every valid tool name listed.
    for (const [label, text, name] of [
      ["ci-unknown.yml", fixture("setup-expect/ci-unknown.yml"), "foo"],
      ["ci-unknown-case.yml", fixture("setup-expect/ci-unknown-case.yml"), "Claude-Code"],
      ["inline unknown", "setup:\n  expect:\n    - cursor\n    - foo\n", "foo"],
      ["inline unknown case", "setup:\n  expect: [Claude-Code]\n", "Claude-Code"],
    ] as const) {
      const message = errorOf(label, text);
      expect(message, label).toContain("setup.expect");
      expect(message, label).toContain(`"${name}"`);
      for (const tool of AGENT_TOOLS) expect(message, `${label}: lists ${tool}`).toContain(tool);
    }

    // A list under a key that takes none: the error still names coverage.exclude and now names setup.expect.
    for (const [label, text] of [
      ["ci-list-elsewhere.yml", fixture("setup-expect/ci-list-elsewhere.yml")],
      ["inline flow list at setup.require", "setup:\n  require: [true]\n"],
      ["inline block list at setup.require", "setup:\n  require:\n    - true\n"],
    ] as const) {
      const message = errorOf(label, text);
      expect(message, label).toContain("except as the value of coverage.exclude");
      expect(message, label).toContain("setup.expect");
    }
  });
});
