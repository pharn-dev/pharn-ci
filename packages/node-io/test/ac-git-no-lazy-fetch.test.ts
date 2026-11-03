import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit, runGitBatch, streamGit } from "../src/io.js";

// Review 2026-11-01, finding 36: GIT_NO_LAZY_FETCH=1 reached only the batch runner, so `git diff` and `ls-tree` in a
// partial clone could still fetch from the remote. A fake `git` first on PATH prints the variable it was given.

let dir: string;
let savedPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pharn-ci-git-env-"));
  writeFileSync(join(dir, "git"), '#!/bin/sh\nprintf "%s" "${GIT_NO_LAZY_FETCH:-unset}"\n');
  chmodSync(join(dir, "git"), 0o755);
  savedPath = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${savedPath ?? ""}`;
});

afterEach(() => {
  process.env.PATH = savedPath;
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("every local git call stays local", () => {
  it("runGit, streamGit and runGitBatch all pass GIT_NO_LAZY_FETCH=1", async () => {
    expect(await runGit(dir, ["ls-files"])).toBe("1");
    let streamed = "";
    for await (const chunk of streamGit(dir, ["diff"])) streamed += chunk;
    expect(streamed).toBe("1");
    expect((await runGitBatch(dir, ["cat-file", "--batch"], "")).toString("utf8")).toBe("1");
  });
});
