import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gitDiffArgs } from "../../core/src/index.js";
import { LOCAL_GIT_SUBCOMMANDS, localGitArgs, runGit, streamGit } from "../src/io.js";

// The shared git runners run only local, read-only git subcommands, and refuse options that make git run another
// program or write a file. A refused call never starts git.

let dir: string;

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-git-allowlist-")));
  execFileSync("git", ["init", "-q"], { cwd: dir });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function drain(chunks: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const chunk of chunks) text += chunk;
  return text;
}

async function caught(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected the promise to reject");
}

/** Both runners refuse `args` with the same message, without running git. */
async function expectRefused(args: string[], message: string): Promise<void> {
  const whole = await caught(runGit(dir, args));
  expect(whole.message, `runGit ${args.join(" ")}`).toBe(message);
  const streamed = await caught(drain(streamGit(dir, args)));
  expect(streamed.message, `streamGit ${args.join(" ")}`).toBe(message);
}

describe("@pharn-ci/node-io git allowlist", () => {
  it("allows exactly the local subcommands pharn-ci and the runner tests use", () => {
    expect([...LOCAL_GIT_SUBCOMMANDS]).toEqual([
      "cat-file",
      "diff",
      "hash-object",
      "log",
      "ls-files",
      "ls-tree",
      "merge-base",
      "rev-parse",
    ]);
  });

  it("passes every argument list pharn-ci runs through unchanged", () => {
    for (const args of [
      gitDiffArgs("origin/main"),
      gitDiffArgs("-x", "abc123"),
      ["ls-files", "-z", "--full-name", "--", ":/"],
      ["ls-files", "-z"],
      ["ls-tree", "-r", "-l", "-z", "--full-tree", "HEAD"],
      ["rev-parse", "--show-toplevel"],
      ["rev-parse", "HEAD"],
      ["rev-parse", "--verify", "--quiet", "--end-of-options", "main^{commit}"],
      ["cat-file", "--batch-check"],
      ["cat-file", "--batch"],
      ["merge-base", "a", "b"],
    ]) {
      expect(localGitArgs(args), args.join(" ")).toEqual(args);
    }
  });

  it("refuses a subcommand outside the allowlist, remote ones included", async () => {
    const allowed = "cat-file, diff, hash-object, log, ls-files, ls-tree, merge-base, rev-parse";
    for (const sub of ["clone", "fetch", "pull", "ls-remote", "push", "config", "-c", "--upload-pack=touch x", ""]) {
      await expectRefused(
        [sub, "--upload-pack=touch pwned", "origin"],
        `git ${sub} is not allowed: pharn-ci runs only these git subcommands: ${allowed}`,
      );
    }
    await expectRefused([], `git  is not allowed: pharn-ci runs only these git subcommands: ${allowed}`);
    expect(existsSync(join(dir, "pwned"))).toBe(false);
  });

  it("refuses options that run a program or write a file before --end-of-options or --", async () => {
    for (const option of [
      "--upload-pack=touch pwned",
      "--receive-pack=touch pwned",
      "--exec=touch pwned",
      "--output=pwned",
      "--ext-diff",
    ]) {
      await expectRefused(["diff", option, "HEAD"], `git diff: the option "${option}" is not allowed`);
      await expectRefused(["ls-files", "-z", option], `git ls-files: the option "${option}" is not allowed`);
    }
    await expectRefused(["hash-object", "-w", "--stdin"], 'git hash-object: the option "-w" is not allowed');
    for (const option of ["--textconv", "--filters", "--filters=x"]) {
      await expectRefused(["cat-file", option, "HEAD:x"], `git cat-file: the option "${option}" is not allowed`);
    }
    expect(existsSync(join(dir, "pwned"))).toBe(false);
  });

  it("does not read an argument after --end-of-options or -- as an option", async () => {
    expect(localGitArgs(["rev-parse", "--verify", "--end-of-options", "--upload-pack"])).toEqual([
      "rev-parse",
      "--verify",
      "--end-of-options",
      "--upload-pack",
    ]);
    expect(localGitArgs(["ls-files", "--", "--output=x"])).toEqual(["ls-files", "--", "--output=x"]);
    // git itself then fails on the revision: its own error, not the allowlist's.
    const err = await caught(runGit(dir, ["rev-parse", "--verify", "--quiet", "--end-of-options", "--upload-pack"]));
    expect(err.message).not.toContain("is not allowed");
  });

  it("returns a new array whose subcommand is the allowlist's own constant", () => {
    const args = ["ls-tree", "HEAD"];
    const safe = localGitArgs(args);
    expect(safe).not.toBe(args);
    expect(LOCAL_GIT_SUBCOMMANDS).toContain(safe[0]);
  });
});
