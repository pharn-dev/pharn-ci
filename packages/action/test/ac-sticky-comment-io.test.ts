import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The modules are imported inside each test body, like the other AC tests written before the build.

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pharn-ci-node-io-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the promise to reject");
}

describe("action: Node wiring module", () => {
  it("AC-3: readFile returns null for a missing path and rejects with the original error otherwise", async () => {
    const { createNodeIo } = await import("../src/node-io.js");
    const dir = tempDir();
    const io = createNodeIo(dir);

    expect(await io.readFile(join(dir, "no-such-file.info"))).toBeNull();

    // Reading a directory fails with EISDIR, not ENOENT: that error is passed through unchanged.
    const expected = (await caught(readFile(dir, "utf8"))) as NodeJS.ErrnoException;
    const actual = (await caught(io.readFile(dir))) as NodeJS.ErrnoException;
    expect(expected.code).toBe("EISDIR");
    expect(actual).toBeInstanceOf(Error);
    expect(actual.code).toBe(expected.code);
    expect(actual.message).toBe(expected.message);
  });

  it("AC-3: git rejects with an error whose message is the failing command's stderr", async () => {
    const { createNodeIo } = await import("../src/node-io.js");
    const dir = tempDir();
    expect(spawnSync("git", ["init", "-q"], { cwd: dir }).status).toBe(0);
    const args = ["rev-parse", "--verify", "refs/heads/no-such-branch"];
    const direct = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    expect(direct.status).not.toBe(0);
    expect(direct.stderr).not.toBe("");

    const err = (await caught(createNodeIo(dir).git(args))) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(direct.stderr);
  });

  it("AC-3: writeFile creates missing parent directories and writes the text", async () => {
    const { createNodeIo } = await import("../src/node-io.js");
    const dir = tempDir();
    const target = join(dir, "pharn-ci", "nested", "deeper", "report.json");
    await createNodeIo(dir).writeFile(target, '{"verdict":"pass"}\n');
    expect(readFileSync(target, "utf8")).toBe('{"verdict":"pass"}\n');
  });
});

describe("action: GitHub API adapter", () => {
  it("AC-3: viewerLogin returns null when GET /user is rejected, and createComment returns the author login", async () => {
    const { createGitHubApi } = await import("../src/api.js");
    const createComment = vi.fn(async () => ({
      data: { id: 77, body: "<!-- pharn-ci -->", user: { login: "pharn-app[bot]", type: "Bot" } },
    }));
    const octokit = {
      rest: {
        users: {
          getAuthenticated: vi.fn(async () => {
            throw Object.assign(new Error("Resource not accessible by integration"), { status: 403 });
          }),
        },
        issues: { createComment },
      },
    };
    const api = createGitHubApi({
      token: "t0ken",
      repo: () => ({ owner: "acme", repo: "demo" }),
      getOctokit: () => octokit,
    } as never);

    expect(await api.viewerLogin()).toBeNull();
    expect(await api.createComment(7, "<!-- pharn-ci -->\nbody")).toBe("pharn-app[bot]");
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(createComment).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "acme", repo: "demo", issue_number: 7, body: "<!-- pharn-ci -->\nbody" }),
    );
  });
});
