import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GIT_TIMEOUT_MS, nodeDeps } from "../src/nodeDeps.js";

// F-17: a hung git must not hang the CLI.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("nodeDeps git timeout (F-17)", () => {
  it("kills a git call that runs past the timeout and says so", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pharn-ci-cli-git-timeout-"));
    dirs.push(dir);
    // `git hash-object --stdin` waits for stdin, which execFile never closes: it runs until killed.
    const deps = nodeDeps(dir, { gitTimeoutMs: 100 });
    await expect(deps.git(["hash-object", "--stdin"])).rejects.toThrow("git hash-object timed out after 0.1 s");
  });

  it("defaults to two minutes", () => {
    expect(GIT_TIMEOUT_MS).toBe(120_000);
  });
});
