import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), renderMarkdown() and acceptTestIntegrity() are loaded inside each test body: the AC tests are written before
// check A7 exists, so nothing the build adds may run while the file loads. The inputs are built as
// packages/core/test/golden.test.ts builds them; `agentConfigSources` is passed through a cast because CheckInput does
// not declare it before the build.
//
// No complete secret is written in this file (gitleaks, GitHub push protection, and AC-22 runs findSecretSpans over
// this file as committed). Every secret is assembled at test time from a prefix and a run cut from ALPHABET.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** `n` distinct characters of ALPHABET, stepping 7 places from `seed` (7 is coprime with 62). */
function cut(n: number, seed: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[(seed + i * 7) % ALPHABET.length];
  return s;
}

const gh = (seed: number) => "ghp" + "_" + cut(36, seed);
const ENV = (name: string) => "$" + `{${name}}`;

const REPO_ROOT = "/home/runner/work/demo/demo";
const GOLDEN_FILES = fixture("golden/files.txt").trim().split("\n");
const SOURCE_FILES = ["README.md", "src/math.ts", "src/new.ts", "src/utils/new-name.ts"];

type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[] } & Record<string, unknown>;
type SourceFile = { path: string; text: string };
type Sources = { unavailable: string } | { files: SourceFile[]; dropped: { path: string; reason: string }[] };

interface Core {
  check(input: unknown): Report;
  renderMarkdown(report: Report): string;
  acceptTestIntegrity(report: Report, accepted: { label: string; by: string }): Report;
}

async function load(): Promise<Core> {
  return (await import("../src/index.js")) as unknown as Core;
}

/** The fixtures/golden check input, with the repo files, threshold and extra fields given. */
function goldenInput(extra: Record<string, unknown> = {}) {
  return {
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: GOLDEN_FILES,
    ...extra,
  };
}

/** A check input that passes on its own (threshold 70), with `paths` as the only agent setup files. */
function passingInput(paths: string[], sources?: Sources, extra: Record<string, unknown> = {}) {
  return goldenInput({
    threshold: 70,
    repoFiles: [...paths, ...SOURCE_FILES],
    ...(sources === undefined ? {} : { agentConfigSources: sources }),
    ...extra,
  });
}

const a7 = (report: Report) => report.messages.filter((m) => m.code.startsWith("AGENT_CONFIG_SECRET_"));

/** The AC-12 and AC-13 files: S01 on 7 lines, one S10 value, one S11 literal, marker key names and a marker word. */
function markedFiles() {
  const s01 = [1, 2, 3, 4, 5, 6, 7].map((i) => gh(i * 3));
  const s10 = cut(28, 40);
  const s11 = "Wq7zLitVal9";
  const files: SourceFile[] = [
    {
      path: ".mcp.json",
      text: [
        "{",
        '  "mcpServers": {',
        `    "github": { "env": { "zqxMarkerToken": "${s01[0]}" } },`,
        '    "qmarkerword": { "command": "npx" },',
        `    "gh2": { "env": { "zqxMarkerGhToken": "${s01[1]}" } },`,
        `    "svc": { "env": { "zqxMarkerApiKey": "${s10}" } },`,
        `    "gh3": { "args": ["--zqx-marker-token", "${s01[2]}"] }`,
        "  }",
        "}",
        "",
      ].join("\n"),
    },
    {
      path: ".codex/config.toml",
      text: [
        "# qmarkerword codex settings",
        `zqxMarkerToken = "${s01[3]}"`,
        `zqx_marker_auth = "${s01[4]}"`,
        `ZQX_MARKER_DB_TOKEN = "${ENV("ZQX_MARKER_DB_TOKEN")}"`,
        `ZQX_MARKER_PASSWORD = "${s11}"`,
        "",
      ].join("\n"),
    },
    {
      path: ".claude/hooks/a.sh",
      text: [
        "#!/bin/sh",
        `export ZQX_MARKER_TOKEN="${s01[5]}"`,
        "echo qmarkerword",
        `curl -H "x-zqx: ${s01[6]}" https://api.internal.io/qmarkerword`,
        "",
      ].join("\n"),
    },
  ];
  return { files, secrets: [...s01, s10, s11] };
}

/** The code spans of a markdown text, read as CommonMark reads them (a run of n backticks closes on n backticks). */
function codeSpans(text: string): string[] {
  const spans: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      i++;
      continue;
    }
    let n = 0;
    while (text[i + n] === "`") n++;
    const open = i + n;
    let j = open;
    let close = -1;
    while (j < text.length) {
      if (text[j] !== "`") {
        j++;
        continue;
      }
      let m = 0;
      while (text[j + m] === "`") m++;
      if (m === n) {
        close = j;
        break;
      }
      j += m;
    }
    if (close === -1) {
      i = open;
      continue;
    }
    spans.push(text.slice(open, close));
    i = close + n;
  }
  return spans;
}

/** The hint line under the message line of `code` in the rendered comment. */
function hintOf(markdown: string, code: string): string {
  const lines = markdown.split("\n");
  const at = lines.findIndex((line) => line.includes(`\`${code}\``));
  expect(at, `the comment lists ${code}`).toBeGreaterThan(-1);
  return lines[at + 1] ?? "";
}

describe("check A7: agent config secrets in the report", () => {
  it("AC-11: without agentConfigSources the golden report is unchanged; with an S01 in .mcp.json it carries an error", async () => {
    const { check } = await load();
    const without = check(goldenInput());
    expect(`${JSON.stringify(without, null, 2)}\n`).toBe(fixture("golden/report.json"));
    expect(a7(without)).toEqual([]);

    const text = `{\n  "mcpServers": {\n    "github": { "env": { "GITHUB_TOKEN": "${gh(5)}" } }\n  }\n}\n`;
    const withSecret = check(
      goldenInput({ agentConfigSources: { files: [{ path: ".mcp.json", text }], dropped: [] } }),
    );
    expectValidReport(withSecret);
    const s01 = withSecret.messages.filter((m) => m.code === "AGENT_CONFIG_SECRET_S01");
    expect(s01).toHaveLength(1);
    expect(s01[0]?.level).toBe("error");
  });

  it("AC-12: one message per id with fixed levels, the first 5 locations then a count, a fail verdict and a hint for each code", async () => {
    const { check, renderMarkdown } = await load();
    const { files } = markedFiles();
    const report = check(
      passingInput([".mcp.json", ".codex/config.toml", ".claude/hooks/a.sh"], { files, dropped: [] }),
    );
    expectValidReport(report);

    expect(a7(report).map((m) => `${m.code} ${m.level}`)).toEqual([
      "AGENT_CONFIG_SECRET_S01 error",
      "AGENT_CONFIG_SECRET_S10 warn",
      "AGENT_CONFIG_SECRET_S11 info",
    ]);
    expect(report.verdict).toBe("fail");

    const s01 = (a7(report)[0] as Message).text;
    expect(s01).toContain("S01");
    expect(s01, "names the shape").toMatch(/GitHub/i);
    const locations = [
      "`.claude/hooks/a.sh` line 2",
      "`.claude/hooks/a.sh` line 4",
      "`.codex/config.toml` line 2",
      "`.codex/config.toml` line 3",
      "`.mcp.json` line 3",
    ];
    let from = 0;
    for (const location of locations) {
      const at = s01.indexOf(location, from);
      expect(at, `${location}, in order`).toBeGreaterThanOrEqual(from);
      from = at + location.length;
    }
    expect(s01.indexOf("and 2 more", from), "then: and 2 more").toBeGreaterThanOrEqual(from);
    expect(s01).not.toContain("`.mcp.json` line 5");
    expect(s01).not.toContain("`.mcp.json` line 7");

    const markdown = renderMarkdown(report);
    for (const code of ["AGENT_CONFIG_SECRET_S01", "AGENT_CONFIG_SECRET_S10", "AGENT_CONFIG_SECRET_S11"]) {
      expect(hintOf(markdown, code), `a hint under ${code}`).toMatch(/^\s+- Hint: \S/);
    }
  });

  it("AC-13: neither the report JSON nor the comment holds a secret, a 4-character prefix of one, a key name or other file text", async () => {
    const { check, renderMarkdown } = await load();
    const { files, secrets } = markedFiles();
    const report = check(
      passingInput([".mcp.json", ".codex/config.toml", ".claude/hooks/a.sh"], { files, dropped: [] }),
    );
    expect(report.messages.some((m) => m.code === "AGENT_CONFIG_SECRET_S01")).toBe(true);

    const json = JSON.stringify(report, null, 2);
    const lines = [...json.split("\n"), ...renderMarkdown(report).split("\n")];
    for (const line of lines) {
      for (const secret of secrets) {
        expect(line.includes(secret), `a seeded secret in: ${line}`).toBe(false);
        expect(line.includes(secret.slice(0, 4)), `a 4-character prefix of a seeded secret in: ${line}`).toBe(false);
      }
      expect(/zqx/i.test(line), `a marker key name in: ${line}`).toBe(false);
      expect(line.includes("qmarkerword"), `the marker word in: ${line}`).toBe(false);
    }
  });

  it("AC-14: an S10-only finding makes the verdict warn and an S11-only finding leaves it pass", async () => {
    const { check } = await load();
    const control = check(passingInput([".mcp.json"]));
    expect(control.verdict, "control: the input passes without agent config sources").toBe("pass");

    const s10 = check(
      passingInput([".mcp.json"], {
        files: [{ path: ".mcp.json", text: `{\n  "svc": { "env": { "apiKey": "${cut(28, 41)}" } }\n}\n` }],
        dropped: [],
      }),
    );
    expectValidReport(s10);
    expect(a7(s10).map((m) => `${m.code} ${m.level}`)).toEqual(["AGENT_CONFIG_SECRET_S10 warn"]);
    expect(s10.verdict).toBe("warn");

    const s11Text = `{\n  "env": {\n    "GITHUB_TOKEN": "${ENV("GITHUB_TOKEN")}",\n    "DB_PASSWORD": "hunter2-staging"\n  }\n}\n`;
    const s11 = check(passingInput([".mcp.json"], { files: [{ path: ".mcp.json", text: s11Text }], dropped: [] }));
    expectValidReport(s11);
    expect(a7(s11).map((m) => `${m.code} ${m.level}`)).toEqual(["AGENT_CONFIG_SECRET_S11 info"]);
    expect(s11.verdict).toBe("pass");
  });

  it("AC-15: unscanned files are an error when dropped as too-large, over-file-cap, over-total-cap or unsafe-path, a warning otherwise, and an unavailable scan is one warning", async () => {
    const { check } = await load();
    const clean = { path: ".mcp.json", text: '{\n  "mcpServers": {}\n}\n' };
    const unscanned = (report: Report) => {
      expectValidReport(report);
      const found = a7(report).filter((m) => m.code === "AGENT_CONFIG_SECRET_UNSCANNED");
      expect(found, "one AGENT_CONFIG_SECRET_UNSCANNED message").toHaveLength(1);
      return found[0] as Message;
    };

    const dropped = [
      { path: ".claude/settings.json", reason: "too-large" },
      { path: ".cursor/mcp.json", reason: "over-file-cap" },
      { path: ".vscode/mcp.json", reason: "over-total-cap" },
      { path: ".codex/config.toml", reason: "unsafe-path" },
      { path: ".gemini/settings.json", reason: "binary" },
      { path: "opencode.json", reason: "missing" },
    ];
    const notRead = ".aider.conf.yml";
    const all = check(passingInput([clean.path, ...dropped.map((d) => d.path), notRead], { files: [clean], dropped }));
    const allMessage = unscanned(all);
    expect(allMessage.level).toBe("error");
    for (const { path, reason } of dropped) {
      expect(allMessage.text, `names ${path}`).toContain(`\`${path}\``);
      const at = allMessage.text.indexOf(`\`${path}\``);
      expect(allMessage.text.indexOf(reason, at), `names ${path} with its reason ${reason}`).toBeGreaterThan(at);
    }
    expect(allMessage.text, `names ${notRead}`).toContain(`\`${notRead}\``);

    for (const reason of ["too-large", "over-file-cap", "over-total-cap", "unsafe-path"]) {
      const one = { path: ".claude/settings.json", reason };
      const report = check(passingInput([clean.path, one.path], { files: [clean], dropped: [one] }));
      const message = unscanned(report);
      expect(message.level, `${reason} fails closed`).toBe("error");
      expect(report.verdict, `${reason}: verdict`).toBe("fail");
    }

    const softDrops = [
      { path: ".gemini/settings.json", reason: "binary" },
      { path: "opencode.json", reason: "missing" },
    ];
    for (const one of softDrops) {
      const message = unscanned(check(passingInput([clean.path, one.path], { files: [clean], dropped: [one] })));
      expect(message.level, `${one.reason} only`).toBe("warn");
      expect(message.text).toContain(`\`${one.path}\``);
    }
    const neither = unscanned(check(passingInput([clean.path, notRead], { files: [clean], dropped: [] })));
    expect(neither.level, "a selected path in neither list").toBe("warn");
    expect(neither.text).toContain(`\`${notRead}\``);
    const soft = unscanned(
      check(
        passingInput([clean.path, ...softDrops.map((d) => d.path), notRead], { files: [clean], dropped: softDrops }),
      ),
    );
    expect(soft.level, "binary, missing and neither together").toBe("warn");

    const reason = "git cat-file failed: `bad object`\nsecond line";
    const unavailable = check(passingInput([".mcp.json", ".claude/settings.json"], { unavailable: reason }));
    expectValidReport(unavailable);
    const messages = a7(unavailable);
    expect(messages.map((m) => `${m.code} ${m.level}`)).toEqual(["AGENT_CONFIG_SECRET_UNSCANNED warn"]);
    const text = (messages[0] as Message).text;
    expect(text.includes("\n"), "one line").toBe(false);
    expect(
      codeSpans(text).filter((span) => span.includes("bad object") && span.includes("second line")),
      "the reason is one code span",
    ).toHaveLength(1);
  });

  it("AC-16: test_integrity.mode off and the accept label leave an AGENT_CONFIG_SECRET_S01 error and the fail verdict", async () => {
    const { check, acceptTestIntegrity } = await load();
    const text = `{\n  "mcpServers": {\n    "github": { "env": { "GITHUB_TOKEN": "${gh(9)}" } }\n  }\n}\n`;
    const sources = { files: [{ path: ".mcp.json", text }], dropped: [] };
    const s01Levels = (report: Report) =>
      report.messages.filter((m) => m.code === "AGENT_CONFIG_SECRET_S01").map((m) => m.level);

    for (const mode of [{ config: "off" }, { input: "off" }, { input: "off", config: "off" }]) {
      const label = JSON.stringify(mode);
      const report = check(passingInput([".mcp.json"], sources, { testIntegrityMode: mode }));
      expectValidReport(report);
      expect(s01Levels(report), `${label}: S01 level`).toEqual(["error"]);
      expect(report.verdict, `${label}: verdict`).toBe("fail");

      const accepted = acceptTestIntegrity(report, { label: "pharn/accepted", by: "Reviewer-1" });
      expectValidReport(accepted);
      expect(s01Levels(accepted), `${label}, accepted: S01 level`).toEqual(["error"]);
      expect(accepted.verdict, `${label}, accepted: verdict`).toBe("fail");
    }
  });
});
