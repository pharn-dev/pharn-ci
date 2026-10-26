import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The schemas, agents.ts and core's index are read inside each test body: the build changes or adds them after this
// test is written, so nothing the build adds may run while this file loads.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(new URL(path, `file://${ROOT}`), "utf8");
const atCommit = (commit: string, path: string) =>
  execFileSync("git", ["show", `${commit}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const DESCRIPTION =
  "true when the pull request counts as an agent PR, including when detection could not read all of its evidence; false when the run has no pull request.";

const AGENT_HINT_LINE = '        "agentHint": { "type": ["string", "null"] },';
const INSERTED_LINES = [
  '        "isAgentPr": {',
  `          "description": "${DESCRIPTION}",`,
  '          "type": "boolean"',
  "        },",
];

// Core's index loads cold and git is spawned, either of which can take seconds on a loaded host.
describe("agent-pr-detection: schemas, purity and exports", { timeout: 60_000 }, () => {
  it("AC-9: report.v2.json gains meta.properties.isAgentPr as given and report.v1.json is byte-identical to 3ed722f", () => {
    const v2Text = read("schema/report.v2.json");
    const v2 = JSON.parse(v2Text);
    expect(v2.properties.meta.properties.isAgentPr).toEqual({ description: DESCRIPTION, type: "boolean" });

    const lines = v2Text.split("\n");
    const at = lines.indexOf(AGENT_HINT_LINE);
    expect(at, "the agentHint line of meta.properties").toBeGreaterThan(-1);
    expect(lines.slice(at + 1, at + 1 + INSERTED_LINES.length)).toEqual(INSERTED_LINES);

    expect(read("schema/report.v1.json")).toBe(atCommit("3ed722f", "schema/report.v1.json"));
  });

  it("AC-9: packages/core/src/agents.ts passes core's purity check", async () => {
    const { purityViolations } = await import("./purity-check.js");
    const source = read("packages/core/src/agents.ts");
    expect(source.length).toBeGreaterThan(0);
    expect(purityViolations(source)).toEqual([]);
  });

  it("AC-9: packages/core/src/index.ts exports the agent detection names", async () => {
    const core = (await import("../src/index.js")) as unknown as Record<string, unknown>;
    expect(Array.isArray(core.KNOWN_AGENTS), "KNOWN_AGENTS").toBe(true);
    expect(Array.isArray(core.DEFAULT_AGENT_LABELS), "DEFAULT_AGENT_LABELS").toBe(true);
    for (const name of ["parseCoAuthorTrailers", "detectAgentPr", "agentPrMetaFields", "withAgentPrMeta"]) {
      expect(typeof core[name], name).toBe("function");
    }
  });
});
