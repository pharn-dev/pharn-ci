import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitDiffArgs, parseUnifiedDiff } from "../../core/src/index.js";

// readTestSources, runGitBatch and the new allowlist entries are loaded inside each test body: these tests are
// written before they exist, so nothing that depends on them may run while the file loads.

type Side = { unavailable: string } | { files: { path: string; text: string }[]; dropped: unknown[] };
type Sources = { base: Side; head: Side };
type Reader = (
  deps: { git(args: string[]): Promise<string>; gitBatch(args: string[], input: string): Promise<Uint8Array> },
  options: { base: string; head?: string; diff: readonly unknown[] },
) => Promise<Sources>;
interface Io {
  runGit(cwd: string, args: string[]): Promise<string>;
  runGitBatch(cwd: string, args: string[], input: string): Promise<Uint8Array>;
  localGitArgs(args: readonly string[]): string[];
}

const SLOW = 30_000;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-test-sources-git-")));
  dirs.push(dir);
  return dir;
}

/** A repository whose `main` has `count` test files and whose checked-out `feature` branch modifies every one. */
function repoModifying(count: number): string {
  const dir = tempDir();
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "t"));
  const name = (i: number) => join(dir, `t/m${String(i).padStart(2, "0")}.test.ts`);
  for (let i = 0; i < count; i++) writeFileSync(name(i), `export const v${i} = "base";\n`);
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", "feature");
  for (let i = 0; i < count; i++) writeFileSync(name(i), `export const v${i} = "head";\n`);
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  return dir;
}

async function load() {
  const { readTestSources } = (await import("../src/index.js")) as unknown as { readTestSources: Reader };
  const io = (await import("../src/io.js")) as unknown as Io;
  return { readTestSources, io };
}

async function caught(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected the promise to reject");
}

describe("readTestSources: git calls", () => {
  it(
    "AC-11: makes one merge-base and at most one cat-file --batch-check and one cat-file --batch, whatever the file count",
    async () => {
      const { readTestSources, io } = await load();
      const dir = repoModifying(30);
      const diff = parseUnifiedDiff(await io.runGit(dir, gitDiffArgs("main")));
      expect(diff).toHaveLength(30);

      const calls: string[][] = [];
      const result = await readTestSources(
        {
          git: (args) => {
            calls.push([...args]);
            return io.runGit(dir, args);
          },
          gitBatch: (args, input) => {
            calls.push([...args]);
            return io.runGitBatch(dir, args, input);
          },
        },
        { base: "main", head: "HEAD", diff },
      );

      // The reader did the work: 30 files on each side.
      for (const side of [result.base, result.head]) {
        expect("files" in side && side.files.length, JSON.stringify(side).slice(0, 200)).toBe(30);
      }
      const other = calls.filter((args) => args[0] !== "rev-parse");
      const mergeBase = other.filter((args) => args[0] === "merge-base");
      const batchCheck = other.filter((args) => args[0] === "cat-file" && args.includes("--batch-check"));
      const batch = other.filter((args) => args[0] === "cat-file" && args.includes("--batch"));
      expect(mergeBase).toHaveLength(1);
      expect(batchCheck.length).toBeLessThanOrEqual(1);
      expect(batch.length).toBeLessThanOrEqual(1);
      expect(other.length, JSON.stringify(other)).toBe(mergeBase.length + batchCheck.length + batch.length);
    },
    SLOW,
  );

  it(
    "AC-11: the allowlist lets cat-file and merge-base through and refuses cat-file --textconv and --filters before git starts",
    async () => {
      const { io } = await load();
      const dir = tempDir();
      execFileSync("git", ["init", "-q"], { cwd: dir });

      expect(io.localGitArgs(["cat-file", "--batch-check"])).toEqual(["cat-file", "--batch-check"]);
      expect(io.localGitArgs(["cat-file", "--batch"])).toEqual(["cat-file", "--batch"]);
      expect(io.localGitArgs(["merge-base", "a", "b"])).toEqual(["merge-base", "a", "b"]);

      for (const option of ["--textconv", "--filters"]) {
        const args = ["cat-file", option, "HEAD:x"];
        expect(() => io.localGitArgs(args), option).toThrow("is not allowed");
        const err = await caught(io.runGitBatch(dir, args, ""));
        expect(err.message, option).toContain("is not allowed");
      }
    },
    SLOW,
  );
});

describe("readTestSources: git failures", () => {
  it(
    "AC-12: a base that does not exist, or a directory that is not a repository, gives unavailable sources naming git rev-parse",
    async () => {
      const { readTestSources, io } = await load();
      const repo = repoModifying(1);
      const notARepo = tempDir();
      // A selected path, so the reader has something to read on both sides.
      const diff = [{ path: "t/m00.test.ts", oldPath: "t/m00.test.ts", status: "modified", addedLines: [] }];

      for (const [dir, base] of [
        [repo, "no-such-branch"],
        [notARepo, "main"],
      ] as const) {
        const result = await readTestSources(
          { git: (args) => io.runGit(dir, args), gitBatch: (args, input) => io.runGitBatch(dir, args, input) },
          { base, head: "HEAD", diff },
        );
        for (const side of [result.base, result.head]) {
          expect(side, `${base} in ${dir === repo ? "the repository" : "a plain directory"}`).toEqual({
            unavailable: expect.stringContaining("git rev-parse"),
          });
        }
      }
    },
    SLOW,
  );
});
