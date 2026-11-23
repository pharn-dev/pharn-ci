import { describe, expect, it } from "vitest";
import type { InputErrorText, RawInputs } from "../src/inputs.js";
import type { PolicyFileBase } from "../src/policy/agents.js";
import type { PolicyApplication, PolicyLayers } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument } from "../src/policy/types.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-348 (file-policy-base-union), AC-7. applyPolicy(), resolveInputs() and check() are loaded inside the test body:
// the AC test is written before applyPolicy unites a `file:` policy with its merge-base copy, so nothing the build adds
// may run while this file loads. The base copy forbids `Bash(curl:*)` and the MCP server `evil`, requires the deny rule
// `Read(.env)` and a Stop hook, and allowlists `github`; the head copy removes the four lists and adds `notes` to the
// allowlist. The agent settings and the MCP config break every one of the base's entries.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TEXT: InputErrorText = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};
const BASE_DOCUMENT: PolicyDocument = {
  version: 1,
  setup: {
    forbidden_permissions: ["Bash(curl:*)"],
    required_permissions_deny: ["Read(.env)"],
    forbidden_mcp_servers: ["evil"],
    required_hooks: [{ event: "Stop" }],
    allowed_mcp_servers: ["github"],
  },
};
const HEAD_DOCUMENT: PolicyDocument = { version: 1, setup: { allowed_mcp_servers: ["github", "notes"] } };
const SETTINGS = '{\n  "permissions": {\n    "allow": ["Bash(curl:*)"]\n  }\n}\n';
const MCP_LINES = [
  "{",
  '  "mcpServers": {',
  '    "github": { "command": "node", "args": ["github.js"] },',
  '    "notes": { "command": "node", "args": ["notes.js"] },',
  '    "evil": { "command": "node", "args": ["evil.js"] }',
  "  }",
  "}",
];
const NOTES_LINE = MCP_LINES.findIndex((l) => l.includes('"notes"')) + 1;

/** applyPolicy() as this change gives it: the merge-base copy as a third argument, the policy it used in `policy`. */
type Uniting = (
  layers: PolicyLayers,
  policy: ResolvedPolicy,
  base?: PolicyFileBase,
) => PolicyApplication & { policy?: ResolvedPolicy };

/** The settings POLICY_OVERRIDE_IGNORED names, without the numbers a threshold carries. */
function ignoredNames(report: Report): string[] {
  return report.messages
    .filter((m) => m.code === "POLICY_OVERRIDE_IGNORED")
    .flatMap((m) => {
      const at = m.text.indexOf("applies: ");
      expect(at, "the message lists the settings after 'applies: '").toBeGreaterThan(-1);
      return m.text
        .slice(at + "applies: ".length)
        .replace(/\.$/, "")
        .split(", ")
        .map((entry) => entry.split(" ")[0] ?? "");
    });
}

describe("a file: policy's head copy cannot drop the setup lists its merge-base copy set", { timeout: 60_000 }, () => {
  it("AC-7: the base's forbidden permission, required deny rule, forbidden MCP server and required hook give P02, P03, P05 and P06; a server the head adds to the allowlist still gets P04 and setup.allowed_mcp_servers is recorded looser", async () => {
    const core = { ...(await import("@pharn-ci/core")), check: (await import("./text-coverage.js")).check };
    const applyPolicy: Uniting = core.applyPolicy;
    const base: PolicyFileBase = { kind: "document", document: BASE_DOCUMENT };
    const policy: ResolvedPolicy = { source: "file", version: null, path: "policy/org.json", document: HEAD_DOCUMENT };
    const raw: RawInputs = { coverageFile: "coverage/lcov.info" };
    const resolved = core.resolveInputs({}, raw, TEXT);
    expect(resolved.ok).toBe(true);
    // Narrows the type only: the expect above has already failed the test when resolveInputs did not succeed.
    if (!resolved.ok) throw new Error("resolveInputs failed");
    const application = applyPolicy({ config: {}, raw, resolved: resolved.inputs }, policy, base);
    expect(application.policy, "applyPolicy returns the policy the run uses").toBeDefined();
    expect(application.ignored).toContainEqual(
      expect.objectContaining({ setting: "setup.allowed_mcp_servers", reason: "looser" }),
    );

    const report = core.check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("diff/empty.diff") },
      repoRoot: REPO_ROOT,
      threshold: null,
      repoFiles: ["AGENTS.md", "src/a.ts", "policy/org.json", ".claude/settings.json", ".mcp.json"],
      policy: application.policy,
      policyIgnored: application.ignored,
      policyFileBase: base,
      policySettingsSources: {
        files: [
          { path: ".claude/settings.json", text: SETTINGS },
          { path: ".mcp.json", text: `${MCP_LINES.join("\n")}\n` },
        ],
        dropped: [],
      },
    });
    expectValidReport(report);
    const violations = report.policy?.violations ?? [];
    const has = (id: string, test: (detail: string, path: string | null, line: number | null) => boolean) =>
      violations.some((v) => v.id === id && test(v.detail, v.path, v.line));

    expect(
      has("P02", (d) => d.includes("Bash(curl:*)")),
      "P02 for the base's forbidden permission",
    ).toBe(true);
    expect(
      has("P03", (d) => d === "required deny rule Read(.env) is missing"),
      "P03 for the base's required deny rule",
    ).toBe(true);
    expect(
      has("P05", (d, p) => p === ".mcp.json" && d === "MCP server matches forbidden entry evil"),
      "P05 for the base's forbidden MCP server",
    ).toBe(true);
    expect(
      has("P06", (d) => d === "required hook Stop (any tool) is missing"),
      "P06 for the base's required hook",
    ).toBe(true);
    expect(
      has("P04", (_d, p, l) => p === ".mcp.json" && l === NOTES_LINE),
      "P04 for the server only the head allowlists",
    ).toBe(true);
    expect(
      has("P04", (_d, p, l) => p === ".mcp.json" && l === MCP_LINES.findIndex((x) => x.includes('"github"')) + 1),
      "no P04 for the server both copies allowlist",
    ).toBe(false);

    const named = ignoredNames(report);
    for (const setting of [
      "setup.allowed_mcp_servers",
      "setup.forbidden_permissions",
      "setup.required_permissions_deny",
      "setup.forbidden_mcp_servers",
      "setup.required_hooks",
    ]) {
      expect(named, setting).toContain(setting);
    }
  });
});
