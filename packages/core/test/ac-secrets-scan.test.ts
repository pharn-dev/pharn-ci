import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scanAgentSetup } from "../src/index.js";
import { FIXTURES } from "./helpers.js";

// agentConfigSecretPaths(), SECRET_SCAN_KINDS and scanAgentConfigSecrets() are loaded inside each test body: the AC
// tests are written before the scanner exists, so nothing the build adds may run while the file loads. The
// fixtures/secrets/*.tmpl templates are written by the build, so they are read inside the test body too.
//
// No complete secret is written in this file or in the templates (gitleaks, GitHub push protection, and AC-22 runs
// findSecretSpans over both as committed). Each `{{Sxx}}` placeholder is filled here, at test time, with a secret
// assembled from a prefix and a run cut from ALPHABET.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const UPPER_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** `n` distinct characters of `from`, stepping 7 places from `seed` (7 is coprime with 62 and 36). */
function cut(n: number, seed: number, from = ALPHABET): string {
  let s = "";
  for (let i = 0; i < n; i++) s += from[(seed + i * 7) % from.length];
  return s;
}

const COLON_SLASHES = ":" + "//";

/** One complete secret of pattern `id`, different for each `seed`. */
function secretFor(id: string, seed: number): string {
  switch (id) {
    case "S01":
      return "ghp" + "_" + cut(36, seed);
    case "S02":
      return "sk-" + "ant-" + "api03-" + cut(32, seed);
    case "S03":
      return "sk-" + "proj-" + cut(30, seed);
    case "S04":
      return "AI" + "za" + cut(35, seed);
    case "S05":
      return "AK" + "IA" + cut(16, seed, UPPER_DIGITS);
    case "S06":
      return "xo" + "xb-" + cut(12, seed) + "-" + cut(12, seed + 1);
    case "S07":
      return "sk" + "_live_" + cut(24, seed);
    case "S08":
      return (
        `-----BEGIN RSA PRIVATE` +
        ` KEY-----\n${cut(60, seed)}\n${cut(30, seed + 1)}\n-----END RSA PRIVATE` +
        " KEY-----"
      );
    case "S09":
      return `https${COLON_SLASHES}deploy:${cut(16, seed)}@db.internal.io/app`;
    case "S10":
      return cut(28, seed);
    default:
      throw new Error(`no secret for ${id}`);
  }
}

type Finding = { id: string; path: string; line: number };
type SourceFile = { path: string; text: string };

interface Scanner {
  SECRET_SCAN_KINDS: readonly string[];
  agentConfigSecretPaths(inventory: { files: { path: string; kind: string }[] }): string[];
  scanAgentConfigSecrets(files: readonly SourceFile[]): Finding[];
}

async function load(): Promise<Scanner> {
  return (await import("../src/index.js")) as unknown as Scanner;
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byFinding = (a: Finding, b: Finding) => byCodeUnit(a.id, b.id) || byCodeUnit(a.path, b.path) || a.line - b.line;
const plain = (findings: Finding[]) => findings.map(({ id, path, line }) => ({ id, path, line }));

const PLACEHOLDER = /\{\{(S\d\d)\}\}/g;

/** A template filled with secrets, and the finding each placeholder expects: its id at the line it lands on. */
function fill(template: string, path: string, seedBase: number): { text: string; expected: Finding[] } {
  let text = "";
  let last = 0;
  let seed = seedBase;
  const expected: Finding[] = [];
  for (const m of template.matchAll(PLACEHOLDER)) {
    text += template.slice(last, m.index);
    const id = m[1] as string;
    expected.push({ id, path, line: text.split("\n").length });
    text += secretFor(id, seed++ % 62);
    last = (m.index as number) + m[0].length;
  }
  text += template.slice(last);
  return { text, expected };
}

/** The template files and the agent config paths they stand for. */
const TEMPLATES: Array<[template: string, path: string]> = [
  ["secrets/mcp.json.tmpl", ".mcp.json"],
  ["secrets/config.toml.tmpl", ".codex/config.toml"],
  ["secrets/settings.yml.tmpl", ".aider.conf.yml"],
  ["secrets/hook.sh.tmpl", ".claude/hooks/hook.sh"],
];

/** The eight key/value forms of the SPEC, each as a pattern over a template line holding an S10 placeholder. */
const S10_FORMS: Array<[string, RegExp]> = [
  ['"key": "v"', /"[^"\n]+"\s*:\s*"(?:Bearer |Basic |token )?\{\{S10\}\}"/],
  ["key: v", /^\s*[\w.-]+:\s+(?:Bearer |Basic |token )?\{\{S10\}\}\s*$/],
  ['key = "v"', /[\w.-]+\s*=\s*"(?:Bearer |Basic |token )?\{\{S10\}\}"/],
  ["KEY=v", /(?:^|\s)[A-Za-z_]\w*=\{\{S10\}\}/],
  ['export KEY="v"', /export\s+[A-Za-z_]\w*="\{\{S10\}\}"/],
  ["--key=v", /--[\w.-]+=\{\{S10\}\}/],
  ["--key v", /--[\w.-]+\s+\{\{S10\}\}/],
  ['JSON args "--key", "v"', /"--[\w.-]+"\s*,\s*"\{\{S10\}\}"/],
];
const S10_KEYS = ["apiKey", "api_key", "x-api-key", "client.secret", "AUTH_TOKEN", "authorization"];

/** Every agent setup kind, with one path of that kind. */
const ONE_OF_EACH_KIND: Record<string, string> = {
  "claude-md": "CLAUDE.md",
  "claude-local-md": "CLAUDE.local.md",
  "agents-md": "AGENTS.md",
  "gemini-md": "GEMINI.md",
  "claude-settings": ".claude/settings.json",
  "claude-settings-local": ".claude/settings.local.json",
  "claude-skill": ".claude/skills/release/SKILL.md",
  "claude-hook": ".claude/hooks/pre.sh",
  "claude-agent": ".claude/agents/reviewer.md",
  "claude-command": ".claude/commands/ship.md",
  "cursor-rules": ".cursor/rules/style.mdc",
  "cursor-mcp": ".cursor/mcp.json",
  "copilot-instructions": ".github/copilot-instructions.md",
  "copilot-instructions-scoped": ".github/instructions/ts.instructions.md",
  "copilot-agents": ".github/agents/helper.md",
  "copilot-prompts": ".github/prompts/fix.prompt.md",
  "vscode-mcp": ".vscode/mcp.json",
  "codex-config": ".codex/config.toml",
  "windsurf-rules": ".windsurfrules",
  "cline-rules": ".clinerules",
  "mcp-config": ".mcp.json",
  "claude-rule": ".claude/rules/style.md",
  "aider-config": ".aider.conf.yml",
  "conventions-md": "CONVENTIONS.md",
  "continue-rules": ".continue/rules/a.json",
  "roo-rules": ".roorules",
  "amazonq-rules": ".amazonq/rules/style.md",
  "junie-guidelines": ".junie/guidelines.md",
  "zed-rules": ".rules",
  "augment-rules": ".augment-guidelines",
  "kiro-steering": ".kiro/steering/product.md",
  goosehints: ".goosehints",
  "opencode-config": "opencode.json",
  "gemini-settings": ".gemini/settings.json",
};
const MORE_CONTINUE_RULES = [
  ".continue/rules/b.YAML",
  ".continue/rules/c.yml",
  ".continue/rules/d.md",
  ".continuerules",
];
const SCANNABLE_KINDS = [
  "mcp-config",
  "cursor-mcp",
  "vscode-mcp",
  "claude-settings",
  "claude-settings-local",
  "codex-config",
  "gemini-settings",
  "opencode-config",
  "aider-config",
  "claude-hook",
  "continue-rules",
];

describe("A7 scanner", () => {
  it("AC-8: agentConfigSecretPaths returns, in code-unit order, exactly the paths of the scannable kinds, and of continue-rules only .json, .yaml and .yml files", async () => {
    const { agentConfigSecretPaths, SECRET_SCAN_KINDS } = await load();
    const paths = [...Object.values(ONE_OF_EACH_KIND), ...MORE_CONTINUE_RULES];
    const inventory = scanAgentSetup(paths);
    const kindOf = new Map(inventory.files.map((f) => [f.path, f.kind as string]));
    for (const [kind, path] of Object.entries(ONE_OF_EACH_KIND)) {
      expect(kindOf.get(path), `control: ${path} is classified ${kind}`).toBe(kind);
    }
    for (const path of MORE_CONTINUE_RULES) expect(kindOf.get(path), `control: ${path}`).toBe("continue-rules");

    expect([...SECRET_SCAN_KINDS].sort(byCodeUnit)).toEqual([...SCANNABLE_KINDS].sort(byCodeUnit));

    const expected = [
      ".aider.conf.yml",
      ".claude/hooks/pre.sh",
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".codex/config.toml",
      ".continue/rules/a.json",
      ".continue/rules/b.YAML",
      ".continue/rules/c.yml",
      ".cursor/mcp.json",
      ".gemini/settings.json",
      ".mcp.json",
      ".vscode/mcp.json",
      "opencode.json",
    ].sort(byCodeUnit);
    const selected = agentConfigSecretPaths(inventory);
    expect(selected).toEqual(expected);
    for (const path of selected) expect(path.toLowerCase().endsWith(".md"), path).toBe(false);
  });

  it("AC-9: scanAgentConfigSecrets gives one finding per (id, path, line) at the line of each span start, sorted by id, path, line, with S10 in every key/value form", async () => {
    const { scanAgentConfigSecrets } = await load();
    const templates = TEMPLATES.map(([file, path]) => ({ file, path, text: readFileSync(FIXTURES + file, "utf8") }));

    // Control: the templates hold what the criterion is about.
    const allText = templates.map((t) => t.text).join("\n");
    const lines = allText.split("\n");
    const ids = new Set([...allText.matchAll(PLACEHOLDER)].map((m) => m[1]));
    for (let n = 1; n <= 10; n++) {
      const id = `S${String(n).padStart(2, "0")}`;
      expect(ids.has(id), `a {{${id}}} placeholder`).toBe(true);
    }
    expect(
      lines.some((line) =>
        [...line.matchAll(PLACEHOLDER)].some((m, _i, all) => all.filter((x) => x[1] === m[1]).length >= 2),
      ),
      "a line with two placeholders of the same id",
    ).toBe(true);
    const s10Lines = lines.filter((line) => line.includes("{{S10}}"));
    for (const [form, pattern] of S10_FORMS) {
      expect(
        s10Lines.some((line) => pattern.test(line)),
        `an S10 placeholder in the form ${form}`,
      ).toBe(true);
    }
    for (const key of S10_KEYS) {
      expect(
        s10Lines.some((line) => line.includes(key)),
        `an S10 placeholder under the key ${key}`,
      ).toBe(true);
    }
    for (const t of templates) {
      expect(t.file.endsWith(".tmpl"), `${t.file} keeps the .tmpl suffix`).toBe(true);
      expect(t.text.includes("{{"), `${t.file} has placeholders`).toBe(true);
    }

    const files: SourceFile[] = [];
    const expected: Finding[] = [];
    templates.forEach((t, i) => {
      const filled = fill(t.text, t.path, i * 13 + 1);
      files.push({ path: t.path, text: filled.text });
      expected.push(...filled.expected);
    });
    const unique = [...new Map(expected.map((f) => [`${f.id}\0${f.path}\0${f.line}`, f])).values()].sort(byFinding);

    const found = plain(scanAgentConfigSecrets(files));
    expect(found, "sorted by id, then path, then line").toEqual([...found].sort(byFinding));
    // S11 is AC-10's rule; here every S01 to S10 finding is exactly one placeholder's id at its line.
    expect(found.filter((f) => f.id !== "S11")).toEqual(unique);
  });

  it("AC-10: S11 fires at the literal's line when a file mixes an env-referenced secret key with a literal one, and not for the controls", async () => {
    const { scanAgentConfigSecrets } = await load();
    const json = (env: string, literal: string) =>
      `{\n  "env": {\n    "GITHUB_TOKEN": "${env}",\n    "DB_PASSWORD": "${literal}"\n  }\n}\n`;
    const references = [
      "$" + "{GITHUB_TOKEN}",
      "$GITHUB_TOKEN",
      "%GITHUB_TOKEN%",
      "{env:GITHUB_TOKEN}",
      "{file:~/.secrets/gh}",
    ];

    references.forEach((reference, i) => {
      const path = `case-${i}/.mcp.json`;
      const found = plain(scanAgentConfigSecrets([{ path, text: json(reference, "hunter2-staging") }]));
      expect(found, `env reference ${reference}`).toEqual([{ id: "S11", path, line: 4 }]);
    });

    const ref = references[0] as string;
    const controls: Array<[string, string]> = [
      ["a literal shorter than 8", json(ref, "short1")],
      ["a literal true", json(ref, "true")],
      ["a literal number", json(ref, "12345678")],
      ["a literal URL", json(ref, `https${COLON_SLASHES}vault.internal.io/v1/db`)],
      ["a literal path", json(ref, "/run/secrets/db_password")],
      ["a literal that is already an S01 span", json(ref, secretFor("S01", 40))],
      ["every secret-ish key holds an env reference", json(ref, "$" + "{DB_PASSWORD}")],
      [
        "no secret-ish key holds an env reference",
        '{\n  "env": {\n    "API_TOKEN": "another-literal",\n    "DB_PASSWORD": "hunter2-staging"\n  }\n}\n',
      ],
    ];
    for (const [label, text] of controls) {
      const found = plain(scanAgentConfigSecrets([{ path: ".mcp.json", text }]));
      expect(
        found.filter((f) => f.id === "S11"),
        label,
      ).toEqual([]);
    }
    expect(
      plain(scanAgentConfigSecrets([{ path: ".mcp.json", text: json(ref, secretFor("S01", 40)) }])).map((f) => f.id),
      "control: the S01 literal is found as S01",
    ).toEqual(["S01"]);
  });
});
