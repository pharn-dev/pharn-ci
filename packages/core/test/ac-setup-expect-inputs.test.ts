import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// resolveInputs, the config parser and the fixtures are loaded inside the test body: the AC tests are written before
// setup.expect and fixtures/setup-expect/ exist, so nothing that depends on them may run while the file loads.

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

function text(expectAgentSetup: string) {
  return {
    coverageFormat: (value: string) => `bad format "${value}"`,
    threshold: "THRESHOLD",
    exclude: "EXCLUDE",
    coverageRoot: "ROOT",
    noCoverageFile: "no coverage file",
    expectAgentSetup,
  };
}

type Resolved =
  | { ok: true; inputs: { expectAgentSetup?: unknown } }
  | { ok: false; errors: { input: string; message: string }[] };

describe("resolveInputs: expected agent tools", () => {
  it("AC-6: adds the input's tools after the config's, de-duplicated, and reports an unknown name as an input error under the given label", async () => {
    const { parseConfig } = await import("../src/config.js");
    const { resolveInputs } = await import("../src/inputs.js");
    const resolve = (config: unknown, expectAgentSetup: string[], label: string) =>
      resolveInputs(config as never, { expectAgentSetup } as never, text(label) as never) as unknown as Resolved;

    // Config setup.expect is ["cursor"]; the input adds claude-code and repeats cursor.
    const config = parseConfig(fixture("setup-expect/ci-cursor.yml"));
    const merged = resolve(config, ["claude-code", "cursor"], "--expect-agent-setup");
    expect(merged.ok).toBe(true);
    if (merged.ok) expect(merged.inputs.expectAgentSetup).toEqual(["cursor", "claude-code"]);

    // An unknown name in the input: an error for expectAgentSetup naming the label, quoting the name, listing the tools.
    for (const label of ["--expect-agent-setup", "expect-agent-setup"]) {
      const resolved = resolve({}, ["foo"], label);
      expect(resolved.ok, label).toBe(false);
      if (resolved.ok) continue;
      const errors = resolved.errors.filter((error) => error.input === "expectAgentSetup");
      expect(errors, label).toHaveLength(1);
      const message = (errors[0] as { message: string }).message;
      expect(message, label).toContain(label);
      expect(message, label).toContain('"foo"');
      for (const tool of AGENT_TOOLS) expect(message, `${label}: lists ${tool}`).toContain(tool);
    }
  });
});
