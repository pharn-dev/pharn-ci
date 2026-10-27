import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// E3 item 24a part B (P11), AC-17. readPolicyFileAt and runGitBatch are loaded inside the test body: the AC test is
// written before readPolicyFileAt exists, so nothing the build adds may run while this file loads. The reads go to a
// real temporary repository through runGitBatch; the unsafe path goes through a recording git reader.

type Base = { kind: string; document?: unknown };
type Reader = (
  deps: { gitBatch(args: string[], input: string): Promise<Uint8Array> },
  options: { rev: string; path: string },
) => Promise<Base>;
interface Io {
  runGitBatch(cwd: string, args: string[], input: string): Promise<Uint8Array>;
}

const VALID = { version: 1, agents: { protected_paths: ["src/**"] } };
const MAX = 1_048_576;

describe("node-io: the file: policy read at a git revision", { timeout: 60_000 }, () => {
  it("AC-17: a valid committed policy is a document, a missing path is absent, and invalid JSON, a non-policy document, a file over 1 MiB, a NUL byte, a missing revision and an unsafe path are unreadable with no other key; it never rejects", async () => {
    const { readPolicyFileAt } = (await import("../src/index.js")) as unknown as { readPolicyFileAt: Reader };
    const { runGitBatch } = (await import("../src/io.js")) as unknown as Io;

    // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-p11-policy-at-rev-")));
    try {
      const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
      sh("init", "-q", "-b", "main");
      sh("config", "user.email", "test@example.com");
      sh("config", "user.name", "test");
      sh("config", "commit.gpgsign", "false");
      mkdirSync(join(dir, "policy"));
      const big = `{"version":1}${" ".repeat(MAX)}`;
      const files: Record<string, string> = {
        "policy/valid.json": JSON.stringify(VALID),
        "policy/invalid.json": '{"version":1,',
        "policy/not-policy.json": '["version", 1]',
        "policy/big.json": big,
        "policy/nul.json": '{"version":1}\u0000\n',
      };
      for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
      sh("add", "-A");
      sh("commit", "-q", "-m", "policies");
      const rev = sh("rev-parse", "HEAD").trim();
      expect(Buffer.byteLength(big)).toBeGreaterThan(MAX);

      const deps = { gitBatch: (args: string[], input: string) => runGitBatch(dir, args, input) };
      const at = async (options: { rev: string; path: string }, d = deps): Promise<Base> => {
        let result: Base | undefined;
        let rejected: unknown;
        await readPolicyFileAt(d, options).then(
          (r) => {
            result = r;
          },
          (e) => {
            rejected = e;
          },
        );
        expect(rejected, `${options.rev}:${options.path} never rejects`).toBeUndefined();
        return result as Base;
      };

      expect(await at({ rev, path: "policy/valid.json" })).toStrictEqual({ kind: "document", document: VALID });
      expect(await at({ rev, path: "policy/missing.json" })).toStrictEqual({ kind: "absent" });
      for (const path of ["policy/invalid.json", "policy/not-policy.json", "policy/big.json", "policy/nul.json"]) {
        expect(await at({ rev, path }), path).toStrictEqual({ kind: "unreadable" });
      }
      const missingRev = `${"0".repeat(39)}1`;
      expect(await at({ rev: missingRev, path: "policy/valid.json" }), "a missing revision").toStrictEqual({
        kind: "unreadable",
      });

      const calls: string[][] = [];
      const recording = {
        gitBatch: (args: string[], input: string) => {
          calls.push([...args, input]);
          return runGitBatch(dir, args, input);
        },
      };
      expect(await at({ rev, path: "../policy.json" }, recording), "an unsafe path").toStrictEqual({
        kind: "unreadable",
      });
      expect(calls).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
