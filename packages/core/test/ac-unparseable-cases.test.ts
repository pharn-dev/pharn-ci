import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { withoutFix } from "./v090-codes.js";

// settings-unparseable-fails-closed (review A3-F2), AC-2 to AC-6. Each case under fixtures/policy-settings/unparseable/
// holds policy.json, files.json (repo path → text file in the case directory) and edits.json (the repo paths the change
// edits); the test builds one "modify" hunk per edited path. check() and every fixture are loaded inside the test body,
// the test-first convention.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
type Drop = { path: string; reason: string };
type Case = {
  document: unknown;
  map: Record<string, string>;
  edits: string[];
  read: (file: string) => string;
};

const REPO_ROOT = "/home/runner/work/demo/demo";
const UNCHECKED = "this change edits a file the policy could not check";
const COMPLIES = "this change edits a file the policy checks; it complies";
const SETTINGS = ".claude/settings.json";
const MCP = ".mcp.json";

const modify = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,3 +1,3 @@",
    " {",
    '-  "theme": "light"',
    '+  "theme": "dark"',
    " }",
  ].join("\n");

function loadCase(name: string): Case {
  const read = (file: string) => fixture(`policy-settings/unparseable/${name}/${file}`);
  return {
    document: JSON.parse(read("policy.json")),
    map: JSON.parse(read("files.json")) as Record<string, string>,
    edits: JSON.parse(read("edits.json")) as string[],
    read,
  };
}

async function run(c: Case, files: { path: string; text: string }[], dropped: Drop[] = []): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: `${c.edits.map(modify).join("\n")}\n` },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: [...new Set(["AGENTS.md", "policy/org.json", "src/a.ts", ...Object.keys(c.map), ...c.edits])],
    policy: { source: "file", version: null, path: "policy/org.json", document: c.document },
    policySettingsSources: { files, dropped },
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const textFiles = (c: Case) => Object.entries(c.map).map(([path, from]) => ({ path, text: c.read(from) }));
// fix-hints (H6): every message and finding now carries a `fix`; the pinned literals are unchanged, so these read without it.
const p09 = (report: Report) => withoutFix((report.policy?.violations ?? []).filter((v) => v.id === "P09"));
const invalid = (report: Report) => withoutFix(report.messages.filter((m) => m.code === "POLICY_SETTINGS_INVALID"));
const finding = (severity: string, path: string, detail: string): Violation => ({
  id: "P09",
  severity,
  path,
  line: null,
  detail,
});

/** UTF-8 bytes of `text` with each `{{0xFF}}` marker replaced by the single byte 0xff. */
function withFfByte(text: string): Uint8Array {
  const parts = text.split("{{0xFF}}").map((part) => new TextEncoder().encode(part));
  const out: number[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push(0xff);
    out.push(...part);
  });
  return Uint8Array.from(out);
}

describe("unparseable agent settings and MCP files fail closed under an org policy", { timeout: 60_000 }, () => {
  it("AC-2: deep-pad — settings and MCP files padded past the depth limit fail the check, and P09 blocks both edits", async () => {
    const c = loadCase("deep-pad");
    const files = textFiles(c);
    // The padded texts are valid JSON to the runtime's built-in parser (the one Claude Code runs).
    for (const file of files) expect(() => JSON.parse(file.text)).not.toThrow();
    expect(new Set(c.edits)).toEqual(new Set([SETTINGS, MCP]));

    const report = await run(c, files);
    expect(report.verdict).toBe("fail");
    const found = p09(report);
    expect(found).toContainEqual(finding("block", SETTINGS, UNCHECKED));
    expect(found).toContainEqual(finding("block", MCP, UNCHECKED));
    expect(found.filter((v) => v.detail === COMPLIES)).toEqual([]);
    const messages = invalid(report);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("error");
    expect(messages[0]?.text).toContain("`too-deep`");
  });

  it("AC-3: binary-pad — a settings file with a 0xff byte is a binary drop that fails the check, and P09 blocks the edit", async () => {
    const c = loadCase("binary-pad");
    const { decodeTestSourceText } = await import("@pharn-ci/core");
    // A raw invalid byte cannot be kept in a text fixture, so the fixture carries a {{0xFF}} marker and the test turns
    // it into the byte 0xff, then decodes the bytes the way the Node I/O layer does (null → a `binary` drop).
    const files: { path: string; text: string }[] = [];
    const dropped: Drop[] = [];
    for (const [path, from] of Object.entries(c.map)) {
      const text = decodeTestSourceText(withFfByte(c.read(from)));
      if (text === null) dropped.push({ path, reason: "binary" });
      else files.push({ path, text });
    }
    expect(dropped).toEqual([{ path: SETTINGS, reason: "binary" }]);

    const report = await run(c, files, dropped);
    expect(report.verdict).toBe("fail");
    expect(p09(report)).toContainEqual(finding("block", SETTINGS, UNCHECKED));
    const messages = invalid(report);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("error");
    expect(messages[0]?.text).toContain("`binary`");
  });

  it("AC-4: mcp-only — an MCP file padded past the depth limit is an error under an allowed-servers list, and P09 blocks the edit", async () => {
    const c = loadCase("mcp-only");
    const report = await run(c, textFiles(c));
    expect(p09(report)).toContainEqual(finding("block", MCP, UNCHECKED));
    const messages = invalid(report);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("error");
    expect(messages[0]?.text).toContain("`too-deep`");
  });

  it("AC-5: not-edited — a settings file that is not JSON fails the check even when the change does not edit it", async () => {
    const c = loadCase("not-edited");
    expect(c.edits).not.toContain(SETTINGS);
    const report = await run(c, textFiles(c));
    const messages = invalid(report);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("error");
    expect(messages[0]?.text).toContain("`not-json`");
    expect(report.verdict).toBe("fail");
    expect(p09(report).filter((v) => v.path === SETTINGS)).toEqual([]);
  });

  it("AC-6: complies — unpadded compliant settings and MCP files raise no settings problem, and P09 says both edits comply", async () => {
    const c = loadCase("complies");
    expect(new Set(c.edits)).toEqual(new Set([SETTINGS, MCP]));
    const report = await run(c, textFiles(c));
    expect(invalid(report)).toEqual([]);
    const found = p09(report);
    expect(found).toContainEqual(finding("info", SETTINGS, COMPLIES));
    expect(found).toContainEqual(finding("info", MCP, COMPLIES));
  });
});
