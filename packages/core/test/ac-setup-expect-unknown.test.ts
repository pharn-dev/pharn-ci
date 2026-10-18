import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// check() is loaded inside the test body: the AC tests are written before setup.expect exists.

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

describe("check(): an unknown expected agent tool", () => {
  it("AC-5: throws a ConfigError that quotes the unknown name and lists every valid tool name", async () => {
    const { check } = await import("../src/check.js");
    const { ConfigError } = await import("../src/config.js");
    const input = {
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov", file: "coverage/lcov.info" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: null,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
      expectAgentSetup: ["cursor", "foo"],
    };

    let thrown: unknown;
    try {
      check(input as Parameters<typeof check>[0]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConfigError);
    const message = (thrown as Error).message;
    expect(message).toContain('"foo"');
    for (const tool of AGENT_TOOLS) expect(message, `lists ${tool}`).toContain(tool);
  });
});
