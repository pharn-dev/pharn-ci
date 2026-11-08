import { describe, expect, it } from "vitest";
import type { DiffFile } from "../src/diff/unified.js";
import { evaluatePolicyRules } from "../src/index.js";
import { P13_DIFF_UNAVAILABLE_DETAIL, P13_UNCOMPARED_DETAIL } from "../src/policy/rules/p13.js";
import type { PolicyRuleInput } from "../src/policy/rules/types.js";
import { codeownersWidenings } from "../src/policy/selfmod/codeowners.js";
import { mcpWidenings, parseSide, settingsWidenings } from "../src/policy/selfmod/jsonFiles.js";
import { selectSelfModificationPaths, selfModificationClass } from "../src/policy/selfmod/paths.js";
import { workflowWidenings } from "../src/policy/selfmod/workflows.js";
import type { TestSources } from "../src/testSources.js";
import { measureGrowth } from "./growth.js";
import { fixture } from "./helpers.js";

// Org-policy rule P13, agent self-modification: the per-file comparisons and the rule over evaluatePolicyRules. Inputs
// are the files under fixtures/policy-rules/p13/ (workflow fixtures carry a .txt suffix so no tool treats them as
// workflows).

const p13 = (name: string) => fixture(`policy-rules/p13/${name}`);
const json = (name: string, jsonc = false) => {
  const value = parseSide(p13(name), jsonc);
  if (value === undefined || value === null) throw new Error(`${name} does not parse`);
  return value;
};

describe("P13 agent settings comparison", () => {
  const base = json("settings/base.json.txt");
  const cases: [string, string[]][] = [
    ["settings/allow-grew.json.txt", ["permissions.allow grew"]],
    ["settings/deny-shrank.json.txt", ["permissions.deny shrank"]],
    ["settings/default-mode.json.txt", ["permissions.defaultMode changed"]],
    ["settings/hook-removed.json.txt", ["hooks changed"]],
    ["settings/hook-command.json.txt", ["hooks changed"]],
    [
      "settings/toggles.json.txt",
      [
        "permissions.additionalDirectories grew",
        "disableAllHooks turned on",
        "enableAllProjectMcpServers turned on",
        "enabledMcpjsonServers grew",
        "disabledMcpjsonServers shrank",
      ],
    ],
  ];
  for (const [head, words] of cases) {
    it(`${head} widens: ${words.join(", ")}`, () => {
      expect(settingsWidenings(base, json(head))).toEqual(words);
    });
  }

  it("a narrowing (allow shrank, deny grew, defaultMode removed, servers disabled) and a pure reordering widen nothing", () => {
    expect(settingsWidenings(base, json("settings/narrowed.json.txt"))).toEqual([]);
    expect(settingsWidenings(base, json("settings/reordered.json.txt"))).toEqual([]);
    expect(settingsWidenings(base, base)).toEqual([]);
  });

  it("an added file compares against nothing; a deleted one loses its deny rules and hooks", () => {
    expect(settingsWidenings(null, base)).toEqual([
      "permissions.allow grew",
      "permissions.defaultMode changed",
      "hooks changed",
      "enabledMcpjsonServers grew",
    ]);
    expect(settingsWidenings(base, null)).toEqual([
      "permissions.deny shrank",
      "hooks changed",
      "disabledMcpjsonServers shrank",
    ]);
  });

  it("an unparsable side, a root that is not an object and a permissions value that is not an object cannot be compared", () => {
    expect(parseSide(p13("settings/unparsable.json.txt"), false)).toBeUndefined();
    expect(settingsWidenings(base, parseSide("[]", false) ?? null)).toBeNull();
    expect(settingsWidenings(base, parseSide('{ "permissions": [] }', false) ?? null)).toBeNull();
  });
});

describe("P13 MCP comparison", () => {
  const base = json("mcp/base.json.txt");
  it("a server added and a server whose command, args, url or type changed widen", () => {
    expect(mcpWidenings(".mcp.json", base, json("mcp/server-added.json.txt"))).toEqual(["server added"]);
    expect(mcpWidenings(".mcp.json", base, json("mcp/server-changed.json.txt"))).toEqual(["server changed"]);
    expect(mcpWidenings(".mcp.json", null, base)).toEqual(["server added"]);
  });

  it("a removed server, an env change and a reordering (JSONC, .vscode/mcp.json `servers`) widen nothing", () => {
    expect(mcpWidenings(".mcp.json", base, json("mcp/narrowed.json.txt"))).toEqual([]);
    expect(mcpWidenings(".mcp.json", base, null)).toEqual([]);
    const vscode = json("mcp/vscode-base.jsonc.txt", true);
    expect(mcpWidenings(".vscode/mcp.json", vscode, json("mcp/reordered.jsonc.txt", true))).toEqual([]);
    // `servers` is read only for .vscode/mcp.json: elsewhere the two files hold no servers at all.
    expect(mcpWidenings(".cursor/mcp.json", null, vscode)).toEqual([]);
  });

  it("a server container that is not an object cannot be compared", () => {
    expect(mcpWidenings(".mcp.json", base, parseSide('{ "mcpServers": [] }', false) ?? null)).toBeNull();
  });
});

describe("P13 workflow comparison", () => {
  const base = p13("workflow/base.yml.txt");
  const cases: [string, string[]][] = [
    ["workflow/secret-added.yml.txt", ["secrets referenced grew"]],
    ["workflow/permissions-widened.yml.txt", ["permissions widened"]],
    ["workflow/write-all.yml.txt", ["permissions widened"]],
    ["workflow/permissions-removed.yml.txt", ["permissions block removed"]],
    ["workflow/prt-added.yml.txt", ["pull_request_target trigger added"]],
  ];
  for (const [head, words] of cases) {
    it(`${head} widens: ${words.join(", ")}`, () => {
      expect(workflowWidenings(base, p13(head))).toEqual(words);
    });
  }

  it("narrowed permissions, a removed secret and a job that gains a block equal to the one it inherited widen nothing", () => {
    expect(workflowWidenings(base, p13("workflow/narrowed.yml.txt"))).toEqual([]);
    expect(workflowWidenings(base, base)).toEqual([]);
  });

  it("with no block at the base, a read-only block narrows, and a new job with write scopes widens", () => {
    const jobs = p13("workflow/jobs.yml.txt");
    expect(workflowWidenings(jobs, p13("workflow/jobs-widened.yml.txt"))).toEqual(["permissions widened"]);
    const readOnly = jobs.replace("jobs:\n", "permissions:\n  contents: read\njobs:\n");
    expect(workflowWidenings(jobs, readOnly)).toEqual([]);
    expect(workflowWidenings(jobs, jobs.replace("jobs:\n", "permissions: read-all\njobs:\n"))).toEqual([
      "permissions widened",
    ]);
  });

  it("secrets: inherit and the whole secrets context count as new references", () => {
    const jobs = p13("workflow/jobs.yml.txt");
    expect(
      workflowWidenings(jobs, `${jobs}  call:\n    uses: ./.github/workflows/x.yml\n    secrets: inherit\n`),
    ).toEqual(["secrets referenced grew"]);
    expect(workflowWidenings(jobs, `${jobs}        env:\n          ALL: \${{ toJSON(secrets) }}\n`)).toEqual([
      "secrets referenced grew",
    ]);
  });

  it("an added workflow compares against nothing; a deleted one widens nothing", () => {
    expect(workflowWidenings(null, base)).toEqual(["secrets referenced grew", "permissions widened"]);
    expect(workflowWidenings(base, null)).toEqual([]);
  });

  it("anchors, aliases and merge keys, tab indentation, a second document and a flow-mapped job cannot be compared", () => {
    expect(workflowWidenings(base, p13("workflow/unparsable.yml.txt"))).toBeNull();
    expect(workflowWidenings(p13("workflow/unparsable.yml.txt"), base)).toBeNull();
    expect(
      workflowWidenings(base, base.replace("    runs-on: ubuntu-latest\n", "\truns-on: ubuntu-latest\n")),
    ).toBeNull();
    expect(workflowWidenings(base, `${base}---\nname: other\n`)).toBeNull();
    expect(workflowWidenings(base, `${base}  flow: { runs-on: x, permissions: write-all }\n`)).toBeNull();
  });

  it("a U+0085, U+2028 or U+2029 anywhere, on either side, makes the workflow uncompared (fail closed), never a silent pass", () => {
    for (const separator of ["\x85", "\u{2028}", "\u{2029}"]) {
      const code = separator.charCodeAt(0).toString(16);
      // A YAML 1.1 parser reads the separator as a line break: `permissions: write-all` becomes a key of its own.
      const smuggled = base.replace(
        "  contents: read\njobs:",
        `  contents: read${separator}permissions: write-all\njobs:`,
      );
      expect(smuggled, code).not.toBe(base);
      expect(workflowWidenings(base, smuggled), code).toBeNull();
      expect(workflowWidenings(smuggled, base), code).toBeNull();
      expect(workflowWidenings(null, smuggled), code).toBeNull();
      // In a comment, a run script or the CodeQL witness line, too.
      expect(workflowWidenings(base, `${base}# note${separator}x\n`), code).toBeNull();
      expect(workflowWidenings(base, `${base}-:\t\t\t${separator}x\n`), code).toBeNull();
    }
  });

  it("a key line reads the same with the linear pattern: tabs or spaces after the colon, a quoted key, a list item", () => {
    const jobs = p13("workflow/jobs.yml.txt");
    expect(workflowWidenings(jobs, jobs.replace("jobs:\n", "permissions:\t\t write-all\njobs:\n"))).toEqual([
      "permissions widened",
    ]);
    expect(workflowWidenings(jobs, jobs.replace("jobs:\n", '"permissions":   read-all   \njobs:\n'))).toEqual([
      "permissions widened",
    ]);
    expect(workflowWidenings(jobs, jobs.replace("jobs:\n", "permissions:\n  contents:\t\tread\njobs:\n"))).toEqual([]);
    // `key:value` with no white space after the colon is not a pair, as before.
    expect(workflowWidenings(jobs, jobs.replace("jobs:\n", "permissions:write-all\njobs:\n"))).toEqual([]);
  });
});

describe("P13 CODEOWNERS comparison", () => {
  const base = p13("codeowners/base.txt");
  it("owners appended to unchanged lines and comment or blank-line edits loosen nothing", () => {
    expect(codeownersWidenings(base, p13("codeowners/owners-appended.txt"))).toEqual([]);
    expect(codeownersWidenings(base, p13("codeowners/comments-only.txt"))).toEqual([]);
  });

  it("an owner removed, a line added, an added file and a deleted file loosen", () => {
    expect(codeownersWidenings(base, p13("codeowners/owner-removed.txt"))).toEqual(["rules changed"]);
    expect(codeownersWidenings(base, p13("codeowners/line-added.txt"))).toEqual(["rules changed"]);
    expect(codeownersWidenings(null, base)).toEqual(["file added"]);
    expect(codeownersWidenings(base, null)).toEqual(["file deleted"]);
  });

  it("an owner joined by U+0085, U+2028, U+2029 or a no-break space loosens: GitHub may not split it off; never a silent pass", () => {
    const line = "/.claude/           @acme/platform @acme/security";
    for (const space of ["\x85", "\u{2028}", "\u{2029}", "\xa0", "\u{feff}"]) {
      const code = space.charCodeAt(0).toString(16);
      // Read by white space, the head only adds @agent; to GitHub the last owner may be one token, or two lines.
      expect(codeownersWidenings(base, base.replace(line, `${line}${space}@agent`)), code).toEqual(["rules changed"]);
      expect(
        codeownersWidenings(base, base.replace(line, line.replace(" @acme/security", `${space}@acme/security`))),
        code,
      ).toEqual(["rules changed"]);
    }
  });

  it("a comment line with U+2028 in it counts as a rule line: added, it loosens; unchanged, it loosens nothing", () => {
    for (const separator of ["\x85", "\u{2028}", "\u{2029}"]) {
      const code = separator.charCodeAt(0).toString(16);
      const withNote = `${base}# note${separator}/.claude/ @agent\n`;
      expect(codeownersWidenings(base, withNote), code).toEqual(["rules changed"]);
      expect(codeownersWidenings(withNote, base), code).toEqual(["rules changed"]);
      expect(codeownersWidenings(withNote, withNote), code).toEqual([]);
      const appended = `${p13("codeowners/owners-appended.txt")}# note${separator}/.claude/ @agent\n`;
      expect(codeownersWidenings(withNote, appended), code).toEqual([]);
    }
  });

  it("the comment strip is unchanged for ordinary lines: the first # not after a backslash starts the comment", () => {
    // `\#` is part of the pattern; a trailing comment and a comment edit loosen nothing.
    expect(codeownersWidenings("/a\\#b/ @x # one\n", "/a\\#b/ @x @y # two\n")).toEqual([]);
    expect(codeownersWidenings("/a\\#b/ @x\n", "/a\\#c/ @x\n")).toEqual(["rules changed"]);
    // A `#` right after a character other than a backslash starts a comment too, so both patterns read `/a`.
    expect(codeownersWidenings("/a#b @x\n", "/a#c @x\n")).toEqual([]);
    expect(codeownersWidenings("* @x\n", "#* @x\n")).toEqual(["rules changed"]);
  });
});

describe("P13 paths", () => {
  it("classes the four kinds of file by name and selects the old path on the base side, the new path on the head side", () => {
    expect(selfModificationClass(".claude/settings.json")).toBe("settings");
    expect(selfModificationClass("pkg/.claude/settings.local.json")).toBe("settings");
    expect(selfModificationClass(".cursor/mcp.json")).toBe("mcp");
    expect(selfModificationClass(".github/workflows/ci.yaml")).toBe("workflow");
    expect(selfModificationClass(".github/workflows/sub/ci.yml")).toBeNull();
    expect(selfModificationClass("docs/CODEOWNERS")).toBe("codeowners");
    expect(selfModificationClass("src/CODEOWNERS")).toBeNull();
    const entry = (status: DiffFile["status"], path: string, oldPath = path): DiffFile => ({
      path,
      oldPath,
      status,
      addedLines: [],
    });
    expect(
      selectSelfModificationPaths([
        entry("added", ".mcp.json"),
        entry("modified", ".claude/settings.json"),
        entry("deleted", "CODEOWNERS"),
        entry("renamed", ".github/workflows/new.yml", ".github/workflows/old.yml"),
        entry("modified", "src/a.ts"),
      ]),
    ).toEqual({
      base: [".claude/settings.json", ".github/workflows/old.yml", "CODEOWNERS"],
      head: [".claude/settings.json", ".github/workflows/new.yml", ".mcp.json"],
    });
  });
});

describe("P13 readers are linear on hostile text", { timeout: 300_000 }, () => {
  const SMALL = 100_000;
  const LARGE = 400_000;
  const sized = (prefix: string, unit: string, size: number) =>
    `${prefix}${unit.repeat(Math.ceil((size - prefix.length) / unit.length))}`.slice(0, size);
  const shapes: [string, (size: number) => string, (text: string) => unknown][] = [
    ["unclosed ${{ openers", (n) => sized("on: push\nx: ", "${{ secrets ", n), (t) => workflowWidenings(null, t)],
    [
      "secrets[' with no closing quote",
      (n) => sized("on: push\nx: ", "secrets['", n),
      (t) => workflowWidenings(null, t),
    ],
    [
      "secrets followed by spaces",
      (n) => sized("on: push\nx: ", "secrets      ", n),
      (t) => workflowWidenings(null, t),
    ],
    ["one long key line with no colon", (n) => sized("on: push\n", "a", n), (t) => workflowWidenings(null, t)],
    [
      "many permission scopes",
      (n) => sized("permissions:\n", "  contents: write\n", n),
      (t) => workflowWidenings(t, t),
    ],
    ["CODEOWNERS of hashes", (n) => sized("* @a\n", "#\\#", n), (t) => codeownersWidenings(t, t)],
  ];
  for (const [label, make, read] of shapes) {
    it(`${label}: 400,000 characters take under 8 times as long as 100,000`, async () => {
      const small = make(SMALL);
      const large = make(LARGE);
      read(small);
      read(large);
      const growth = await measureGrowth(
        () => read(small),
        () => read(large),
      );
      expect(growth.ratio, `${label}: ${growth.detail}`).toBeLessThan(8);
    });
  }
});

/** The rule over evaluatePolicyRules, with an agent detection and the sources given. */
describe("P13 over evaluatePolicyRules", () => {
  const AGENT = {
    isAgentPr: true,
    agentHint: null,
    evidence: ["author-bot" as const],
    incomplete: null,
    coAuthors: [],
  };
  const PERSON = { isAgentPr: false, agentHint: null, evidence: [], incomplete: null, coAuthors: [] };
  const INCOMPLETE = { ...PERSON, isAgentPr: true, incomplete: "commits-truncated" as const };
  const diff: DiffFile[] = [
    { path: ".claude/settings.json", oldPath: ".claude/settings.json", status: "modified", addedLines: [3] },
    { path: ".mcp.json", oldPath: ".mcp.json", status: "modified", addedLines: [4] },
    { path: ".github/workflows/ci.yml", oldPath: ".github/workflows/ci.yml", status: "modified", addedLines: [12] },
    { path: ".github/CODEOWNERS", oldPath: ".github/CODEOWNERS", status: "modified", addedLines: [4] },
    { path: "src/a.ts", oldPath: "src/a.ts", status: "modified", addedLines: [1] },
  ];
  const sources = (heads: Record<string, string>): TestSources => ({
    base: {
      files: [
        { path: ".claude/settings.json", text: p13("settings/base.json.txt") },
        { path: ".github/CODEOWNERS", text: p13("codeowners/base.txt") },
        { path: ".github/workflows/ci.yml", text: p13("workflow/base.yml.txt") },
        { path: ".mcp.json", text: p13("mcp/base.json.txt") },
      ],
      dropped: [],
    },
    head: { files: Object.entries(heads).map(([path, text]) => ({ path, text })), dropped: [] },
  });
  const WIDENED = {
    ".claude/settings.json": p13("settings/allow-grew.json.txt"),
    ".mcp.json": p13("mcp/server-added.json.txt"),
    ".github/workflows/ci.yml": p13("workflow/secret-added.yml.txt"),
    ".github/CODEOWNERS": p13("codeowners/owner-removed.txt"),
  };
  const NARROWED = {
    ".claude/settings.json": p13("settings/narrowed.json.txt"),
    ".mcp.json": p13("mcp/narrowed.json.txt"),
    ".github/workflows/ci.yml": p13("workflow/narrowed.yml.txt"),
    ".github/CODEOWNERS": p13("codeowners/owners-appended.txt"),
  };
  const run = (over: Partial<PolicyRuleInput>) =>
    evaluatePolicyRules({
      policy: { source: "app", version: 1, document: { version: 1 } },
      agentSetupFileCount: 1,
      agentTools: [],
      repoFiles: [],
      diff,
      configPath: null,
      ignored: [],
      agentPr: AGENT,
      selfModification: sources(WIDENED),
      ...over,
    } as PolicyRuleInput);
  const findings = (over: Partial<PolicyRuleInput>) => run(over).violations.filter((v) => v.id === "P13");

  it("an agent PR widening each kind of file gets one block finding per file, with fixed words only", () => {
    expect(findings({})).toEqual([
      {
        id: "P13",
        severity: "block",
        path: ".claude/settings.json",
        line: null,
        detail: "agent PR widens its agent settings: permissions.allow grew",
      },
      {
        id: "P13",
        severity: "block",
        path: ".github/CODEOWNERS",
        line: null,
        detail: "agent PR loosens CODEOWNERS: rules changed",
      },
      {
        id: "P13",
        severity: "block",
        path: ".github/workflows/ci.yml",
        line: null,
        detail: "agent PR widens a workflow: secrets referenced grew",
      },
      {
        id: "P13",
        severity: "block",
        path: ".mcp.json",
        line: null,
        detail: "agent PR widens its MCP servers: server added",
      },
    ]);
    expect(JSON.stringify(run({}))).not.toContain("SENTINEL");
  });

  it("the same change by a person gets no finding; an incomplete detection counts as an agent PR, as for P11", () => {
    expect(findings({ agentPr: PERSON })).toEqual([]);
    expect(findings({ agentPr: INCOMPLETE })).toHaveLength(4);
  });

  it("an agent PR that narrows every file gets no finding", () => {
    expect(findings({ selfModification: sources(NARROWED) })).toEqual([]);
  });

  it("no policy, no sources and an app policy that switches P13 off give no finding; an app policy may set warn", () => {
    expect(findings({ policy: { source: "none", document: null } as never })).toEqual([]);
    expect(findings({ selfModification: undefined })).toEqual([]);
    const app = (value: string) =>
      ({ source: "app", version: 1, document: { version: 1, policy: { rules: { P13: value } } } }) as never;
    expect(findings({ policy: app("off") })).toEqual([]);
    expect(findings({ policy: app("warn") }).map((v) => v.severity)).toEqual(["warn", "warn", "warn", "warn"]);
  });

  it("a policy file cannot lower P13: off or warn stays block and is recorded as lowered", () => {
    for (const value of ["off", "warn"]) {
      const evaluation = run({
        policy: {
          source: "file",
          path: ".pharn/policy.json",
          document: { version: 1, policy: { rules: { P13: value } } },
        } as never,
      });
      expect(evaluation.violations.filter((v) => v.id === "P13").map((v) => v.severity)).toEqual([
        "block",
        "block",
        "block",
        "block",
      ]);
      expect(evaluation.lowered).toContain("P13");
    }
  });

  it("a missing diff gives one path-less finding; an unreadable or unparsable side gives a fixed finding for that file", () => {
    expect(findings({ diff: null })).toEqual([
      { id: "P13", severity: "block", path: null, line: null, detail: P13_DIFF_UNAVAILABLE_DETAIL },
    ]);
    const unparsable = sources({ ...NARROWED, ".claude/settings.json": p13("settings/unparsable.json.txt") });
    expect(findings({ selfModification: unparsable })).toEqual([
      { id: "P13", severity: "block", path: ".claude/settings.json", line: null, detail: P13_UNCOMPARED_DETAIL },
    ]);
    const badBase = sources(NARROWED);
    if (!("unavailable" in badBase.base)) {
      badBase.base.files = badBase.base.files.map((file) =>
        file.path === ".github/workflows/ci.yml" ? { ...file, text: p13("workflow/unparsable.yml.txt") } : file,
      );
    }
    expect(findings({ selfModification: badBase }).map((v) => [v.path, v.detail])).toEqual([
      [".github/workflows/ci.yml", P13_UNCOMPARED_DETAIL],
    ]);
    const dropped = sources(NARROWED);
    if (!("unavailable" in dropped.head)) {
      dropped.head.files = dropped.head.files.filter((file) => file.path !== ".mcp.json");
      dropped.head.dropped = [{ path: ".mcp.json", reason: "too-large" }];
    }
    expect(findings({ selfModification: dropped }).map((v) => v.path)).toEqual([".mcp.json"]);
    const unavailable: TestSources = { base: { unavailable: "x" }, head: { unavailable: "x" } };
    expect(findings({ selfModification: unavailable }).map((v) => v.detail)).toEqual(
      Array(4).fill(P13_UNCOMPARED_DETAIL),
    );
  });

  it("an added file is compared against nothing and a deleted one against nothing; a rename is a deletion and an addition", () => {
    const changes: DiffFile[] = [
      { path: ".mcp.json", oldPath: ".mcp.json", status: "added", addedLines: [1] },
      { path: "CODEOWNERS", oldPath: "CODEOWNERS", status: "deleted", addedLines: [] },
      { path: ".github/workflows/new.yml", oldPath: ".github/workflows/ci.yml", status: "renamed", addedLines: [] },
    ];
    const selfModification: TestSources = {
      base: {
        files: [
          { path: "CODEOWNERS", text: p13("codeowners/base.txt") },
          { path: ".github/workflows/ci.yml", text: p13("workflow/base.yml.txt") },
        ],
        dropped: [],
      },
      head: {
        files: [
          { path: ".mcp.json", text: p13("mcp/base.json.txt") },
          { path: ".github/workflows/new.yml", text: p13("workflow/base.yml.txt") },
        ],
        dropped: [],
      },
    };
    expect(findings({ diff: changes, selfModification }).map((v) => [v.path, v.detail])).toEqual([
      [".github/workflows/new.yml", "agent PR widens a workflow: secrets referenced grew, permissions widened"],
      [".mcp.json", "agent PR widens its MCP servers: server added"],
      ["CODEOWNERS", "agent PR loosens CODEOWNERS: file deleted"],
    ]);
  });
});
