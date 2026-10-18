import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { harness } from "./harness.js";

// run() and the fixtures are loaded inside each test body: the AC tests are written before the expect-agent-setup
// input and fixtures/setup-expect/ exist, so nothing that depends on them may run while the file loads. The Action
// runs through the shared harness on a pull_request whose tracked files have CLAUDE.md as the only agent setup file
// (no Cursor setup file), with comments off.

const ROOT = new URL("../../../", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(`fixtures/${path}`, ROOT), "utf8");

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

type Report = { agentSetup: Record<string, unknown> & { missing?: unknown } };

async function runAction(input: string) {
  const { run } = await import("../src/run.js");
  const h = harness({
    inputs: { comment: "false", "expect-agent-setup": input },
    lsFiles: fixture("setup-expect/claude-only.txt").trim().split("\n"),
  });
  await run(h.deps);
  return {
    failed: h.failed,
    report: (): Report => {
      const text = h.written[h.outputs["report-path"] ?? ""];
      if (text === undefined) throw new Error(`no report written at report-path ${h.outputs["report-path"]}`);
      return JSON.parse(text);
    },
  };
}

describe("action input expect-agent-setup", () => {
  it("AC-9: names the expected tools with no setup file from a comma or newline separated input; an empty input adds no agentSetup.missing", async () => {
    for (const input of ["cursor, claude-code", "cursor\nclaude-code"]) {
      const action = await runAction(input);
      expect(action.report().agentSetup.missing, JSON.stringify(input)).toEqual(["cursor"]);
    }

    // No .pharn/ci.yml in the harness, so the config expects nothing: an empty input leaves the field out.
    const empty = await runAction("");
    expect(empty.failed).toEqual([]);
    expect(Object.hasOwn(empty.report().agentSetup, "missing")).toBe(false);
  });

  it("AC-9: an unknown tool name is reported as an error naming expect-agent-setup and listing the valid tools", async () => {
    const action = await runAction("foo");
    expect(action.failed).toHaveLength(1);
    const message = action.failed[0] as string;
    expect(message).toContain("expect-agent-setup");
    expect(message).toContain("foo");
    for (const tool of AGENT_TOOLS) expect(message, `lists ${tool}`).toContain(tool);
  });

  it("AC-9: action.yml declares the expect-agent-setup input", () => {
    const actionYml = readFileSync(new URL("action.yml", ROOT), "utf8");
    const inputsAt = actionYml.search(/^inputs:\s*$/m);
    expect(inputsAt).toBeGreaterThanOrEqual(0);
    const afterInputs = actionYml.slice(inputsAt).split("\n").slice(1);
    const end = afterInputs.findIndex((line) => /^\S/.test(line));
    const inputsBlock = (end === -1 ? afterInputs : afterInputs.slice(0, end)).join("\n");
    expect(inputsBlock).toMatch(/^ {2}expect-agent-setup:\s*$/m);
  });
});
