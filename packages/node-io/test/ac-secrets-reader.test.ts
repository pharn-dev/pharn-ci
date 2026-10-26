import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// readAgentConfigSources is loaded inside the test body: this test is written before it exists, so nothing that
// depends on it may run while the file loads. It reads a real git repository in a temporary directory with the real
// batch git runner, as packages/node-io/test/ac-test-sources-drops.test.ts does.
//
// No complete secret is written in this file (gitleaks, GitHub push protection, and AC-22 runs findSecretSpans over
// this file as committed): the secret is assembled at test time from a prefix and a run cut from ALPHABET.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** `n` distinct characters of ALPHABET, stepping 7 places from `seed` (7 is coprime with 62). */
function cut(n: number, seed: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[(seed + i * 7) % ALPHABET.length];
  return s;
}

type SourceFile = { path: string; text: string };
type Drop = { path: string; reason: string };
type Sources = { unavailable: string } | { files: SourceFile[]; dropped: Drop[] };
type Reader = (
  deps: { gitBatch(args: string[], input: string): Promise<Uint8Array> },
  paths: readonly string[],
) => Promise<Sources>;

const SLOW = 30_000;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo() {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-secrets-reader-")));
  dirs.push(dir);
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  sh("config", "core.symlinks", "true");
  const write = (path: string, content: string | Uint8Array) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  return { dir, sh, write };
}

describe("readAgentConfigSources", () => {
  it(
    "AC-17: reads committed blobs at HEAD: the committed text, a symlink as its link text, and too-large, binary and missing drops",
    async () => {
      const { readAgentConfigSources } = (await import("../src/index.js")) as unknown as {
        readAgentConfigSources: Reader;
      };
      const { runGitBatch } = await import("../src/io.js");
      const r = repo();

      const secret = "ghp" + "_" + cut(36, 3);
      const committed = `{\n  "mcpServers": {\n    "github": { "env": { "GITHUB_TOKEN": "${secret}" } }\n  }\n}\n`;
      r.write(".mcp.json", committed);
      r.write("elsewhere/target.json", `{ "GITHUB_TOKEN": "${"ghp" + "_" + cut(36, 9)}" }\n`);
      mkdirSync(join(r.dir, ".cursor"), { recursive: true });
      symlinkSync("../elsewhere/target.json", join(r.dir, ".cursor/mcp.json"));
      r.write(".gemini/settings.json", `{ "padding": "${"a".repeat(600 * 1024)}" }\n`);
      r.write(".vscode/mcp.json", Uint8Array.from([0x7b, 0x00, 0x7d, 0x0a]));
      r.sh("add", "-A");
      r.sh("commit", "-q", "-m", "agent config files");
      expect(r.sh("ls-files", "-s", ".cursor/mcp.json").startsWith("120000"), "control: a tracked symlink").toBe(true);

      // The working tree drops the secret; only the committed blob holds it.
      writeFileSync(join(r.dir, ".mcp.json"), '{\n  "mcpServers": {}\n}\n');

      const paths = [".cursor/mcp.json", ".gemini/settings.json", ".mcp.json", ".vscode/mcp.json", "opencode.json"];
      const result = await readAgentConfigSources(
        { gitBatch: (args, input) => runGitBatch(r.dir, args, input) },
        paths,
      );
      if ("unavailable" in result) throw new Error(`unavailable: ${result.unavailable}`);

      expect(result.files.find((f) => f.path === ".mcp.json")?.text, "the committed text, secret included").toBe(
        committed,
      );
      expect(result.files.find((f) => f.path === ".cursor/mcp.json")?.text, "the symlink's link text").toBe(
        "../elsewhere/target.json",
      );
      expect(result.dropped).toContainEqual({ path: ".gemini/settings.json", reason: "too-large" });
      expect(result.dropped).toContainEqual({ path: ".vscode/mcp.json", reason: "binary" });
      expect(result.dropped).toContainEqual({ path: "opencode.json", reason: "missing" });
      const held = result.files.map((f) => f.path);
      for (const path of [".gemini/settings.json", ".vscode/mcp.json", "opencode.json"]) {
        expect(held, `${path} is not read`).not.toContain(path);
      }
    },
    SLOW,
  );
});
