import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INPUT_ALIASES, readInput } from "../src/run.js";

const actionYml = readFileSync(new URL("../../../action.yml", import.meta.url), "utf8");

/** Names declared under a top-level section (`inputs:` or `outputs:`) of action.yml. */
function declared(section: "inputs" | "outputs"): string[] {
  const lines = actionYml.split("\n");
  const start = lines.indexOf(`${section}:`);
  expect(start, `action.yml has an ${section}: section`).toBeGreaterThanOrEqual(0);
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const name = line.match(/^ {2}([a-z][a-z0-9-]*):\s*$/)?.[1];
    if (name) names.push(name);
  }
  return names;
}

/**
 * Every input and output pharn-ci has shipped. Before 1.0 none is removed (docs/RELEASING.md); a
 * rename keeps the old name in INPUT_ALIASES and in action.yml. Add new names here, never delete one.
 */
const SHIPPED_INPUTS = [
  "coverage-file",
  "coverage-format",
  "threshold",
  "base-ref",
  "pr-number",
  "head-sha",
  "exclude",
  "coverage-root",
  "require-agent-setup",
  "expect-agent-setup",
  "comment",
  "fail-on-threshold",
  "config",
  "github-token",
];
const SHIPPED_OUTPUTS = ["report-path", "verdict", "diff-coverage"];

function deps(inputs: Record<string, string>) {
  const warnings: string[] = [];
  return {
    warnings,
    deps: { getInput: (name: string) => inputs[name] ?? "", warning: (m: string) => warnings.push(m) },
  };
}

const ALIASES = { "old-threshold": "threshold" };

describe("input aliases (F-19)", () => {
  it("reads the current name, trimmed, without a warning", () => {
    const h = deps({ threshold: " 80 " });
    expect(readInput(h.deps, "threshold", ALIASES)).toBe("80");
    expect(h.warnings).toEqual([]);
  });

  it("falls back to an old name with a deprecation warning naming both", () => {
    const h = deps({ "old-threshold": "75" });
    expect(readInput(h.deps, "threshold", ALIASES)).toBe("75");
    expect(h.warnings).toEqual(['input "old-threshold" is deprecated; rename it to "threshold"']);
  });

  it("prefers the current name when both are set, and warns that the old one is ignored", () => {
    const h = deps({ threshold: "80", "old-threshold": "75" });
    expect(readInput(h.deps, "threshold", ALIASES)).toBe("80");
    expect(h.warnings).toEqual([
      'input "old-threshold" is deprecated and ignored because "threshold" is also set; remove "old-threshold"',
    ]);
  });

  it("treats an empty or blank old name as not given", () => {
    const h = deps({ "old-threshold": "  " });
    expect(readInput(h.deps, "threshold", ALIASES)).toBe("");
    expect(h.warnings).toEqual([]);
  });

  it("uses INPUT_ALIASES by default, which is empty while no input has been renamed", () => {
    expect(INPUT_ALIASES).toEqual({});
    const h = deps({ "old-threshold": "75" });
    expect(readInput(h.deps, "threshold")).toBe("");
    expect(h.warnings).toEqual([]);
  });

  it("keeps every alias declared in action.yml, old name and current name", () => {
    const inputs = declared("inputs");
    for (const [oldName, current] of Object.entries(INPUT_ALIASES)) {
      expect(inputs, `old input ${oldName} stays declared`).toContain(oldName);
      expect(inputs, `current input ${current} is declared`).toContain(current);
    }
  });

  it("never removes a shipped input or output from action.yml", () => {
    expect(declared("inputs")).toEqual(expect.arrayContaining(SHIPPED_INPUTS));
    expect(declared("outputs")).toEqual(expect.arrayContaining(SHIPPED_OUTPUTS));
  });
});
