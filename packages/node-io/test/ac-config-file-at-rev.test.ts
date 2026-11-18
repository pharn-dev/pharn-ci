import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONFIG_FILE_MAX_BYTES, configCopyInUse, readConfigFileAt } from "../src/configFile.js";
import { runGit, runGitBatch } from "../src/io.js";

// CORE-95: readConfigFileAt reads the pharn-ci config at the merge base from committed git objects only, never through
// a symbolic link, and configCopyInUse picks the copy a check runs with from the diff. A real temporary repository:
// `main` holds the base files, `feature` changes them in the working tree's next commit.

const BASE_CONFIG = readFileSync(
  new URL("../../../fixtures/config-at-merge-base/base-ci.yml", import.meta.url),
  "utf8",
);

let dir: string;
const sh = (...args: string[]) =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
const deps = () => ({
  git: (args: string[]) => runGit(dir, args),
  gitBatch: (args: string[], input: string) => runGitBatch(dir, args, input),
});

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-config-at-rev-")));
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, ".pharn"));
  mkdirSync(join(dir, "real"));
  writeFileSync(join(dir, ".pharn/ci.yml"), BASE_CONFIG);
  writeFileSync(join(dir, "real/target.yml"), BASE_CONFIG);
  symlinkSync("../real/target.yml", join(dir, "linked.yml"));
  symlinkSync("real", join(dir, "linkdir"));
  writeFileSync(join(dir, "big.yml"), `# ${"x".repeat(CONFIG_FILE_MAX_BYTES)}\n`);
  writeFileSync(join(dir, "binary.yml"), Buffer.from([0x63, 0x00, 0xff]));
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, ".pharn/ci.yml"), 'coverage:\n  exclude: ["**"]\n');
  sh("add", "-A");
  sh("commit", "-q", "-m", "change");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readConfigFileAt", () => {
  it("AC-11: reads a regular file at the merge base, never the working tree or HEAD, and never through a symbolic link", async () => {
    // Control: HEAD and the working tree hold the change's copy; the base copy is what comes back.
    expect(readFileSync(join(dir, ".pharn/ci.yml"), "utf8")).not.toBe(BASE_CONFIG);
    expect(await readConfigFileAt(deps(), { base: "main", path: ".pharn/ci.yml" })).toEqual({
      kind: "text",
      text: BASE_CONFIG,
    });
    // A symbolic link at the path is unreadable, never its target; one on the way to it holds no entry.
    expect(await readConfigFileAt(deps(), { base: "main", path: "linked.yml" })).toEqual({ kind: "unreadable" });
    expect(await readConfigFileAt(deps(), { base: "main", path: "linkdir/target.yml" })).toEqual({ kind: "absent" });
    expect(await readConfigFileAt(deps(), { base: "main", path: "real/target.yml" })).toEqual({
      kind: "text",
      text: BASE_CONFIG,
    });
    expect(await readConfigFileAt(deps(), { base: "main", path: "none.yml" })).toEqual({ kind: "absent" });
    expect(await readConfigFileAt(deps(), { base: "main", path: "real" })).toEqual({ kind: "unreadable" });
    // Over 1 MiB and not UTF-8 text are unreadable.
    expect(await readConfigFileAt(deps(), { base: "main", path: "big.yml" })).toEqual({ kind: "unreadable" });
    expect(await readConfigFileAt(deps(), { base: "main", path: "binary.yml" })).toEqual({ kind: "unreadable" });
  });

  it("AC-12: an unknown base, no git batch output, and an unsafe path or revision are unreadable without reaching git", async () => {
    expect(await readConfigFileAt(deps(), { base: "no-such-branch", path: ".pharn/ci.yml" })).toEqual({
      kind: "unreadable",
    });
    const calls: string[][] = [];
    const recording = {
      git: async (args: string[]) => {
        calls.push(args);
        return "";
      },
      gitBatch: async () => new Uint8Array(),
    };
    for (const options of [
      { base: "--output=x", path: ".pharn/ci.yml" },
      { base: "main:x", path: ".pharn/ci.yml" },
      { base: "main", path: "../ci.yml" },
      { base: "main", path: ".pharn/./ci.yml" },
      { base: "main", path: "ci\n.yml" },
      { base: "main", path: "/etc/ci.yml" },
    ]) {
      expect(await readConfigFileAt(recording, options), JSON.stringify(options)).toEqual({ kind: "unreadable" });
    }
    expect(calls).toEqual([]);
    // A git that prints nothing useful never gives text.
    expect(await readConfigFileAt(recording, { base: "main", path: ".pharn/ci.yml" })).toEqual({ kind: "unreadable" });
  });
});

describe("configCopyInUse", () => {
  const file = (path: string, status: "added" | "modified" | "deleted" | "renamed", oldPath = path) => ({
    path,
    oldPath,
    status,
    addedLines: [],
  });

  it("AC-13: the diff decides: untouched or no diff reads the working tree, added is absent, modified and deleted read the merge base", async () => {
    const options = { base: "main", configPath: undefined, repoRoot: dir };
    expect(await configCopyInUse(deps(), { ...options, diff: null })).toEqual({ source: "working-tree" });
    expect(await configCopyInUse(deps(), { ...options, diff: [file("src/a.ts", "modified")] })).toEqual({
      source: "working-tree",
    });
    expect(await configCopyInUse(deps(), { ...options, diff: [file(".pharn/ci.yml", "added")] })).toEqual({
      source: "absent",
    });
    const base = { source: "merge-base", path: ".pharn/ci.yml", text: BASE_CONFIG };
    expect(await configCopyInUse(deps(), { ...options, diff: [file(".pharn/ci.yml", "modified")] })).toEqual(base);
    expect(await configCopyInUse(deps(), { ...options, diff: [file(".pharn/ci.yml", "deleted")] })).toEqual(base);
    expect(await configCopyInUse(deps(), { ...options, diff: [file("old.yml", "renamed", ".pharn/ci.yml")] })).toEqual(
      base,
    );
    // No base, no batch reader, or no copy at the merge base: unreadable.
    const modified = [file(".pharn/ci.yml", "modified")];
    expect(await configCopyInUse(deps(), { ...options, base: undefined, diff: modified })).toEqual({
      source: "unreadable",
    });
    expect(await configCopyInUse({ git: deps().git }, { ...options, diff: modified })).toEqual({
      source: "unreadable",
    });
    expect(
      await configCopyInUse(deps(), { ...options, configPath: "none.yml", diff: [file("none.yml", "modified")] }),
    ).toEqual({ source: "unreadable" });
  });
});
