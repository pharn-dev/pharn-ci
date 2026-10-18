import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The shared Node helpers are imported inside each test body: these tests are written before `@pharn-ci/node-io`
// exists, so nothing that depends on it may run while the file loads. They run against a real git repository and
// real files in a temporary directory.

const dirs: string[] = [];
function tempDir(prefix: string): string {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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

/** A git repository with two commits, so `git log` and `git diff` have something to print. */
function gitRepo(): string {
  const dir = tempDir("pharn-ci-node-io-git-");
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n");
  sh("add", ".");
  sh("commit", "-q", "-m", "first");
  writeFileSync(join(dir, "src/a.ts"), "export const a = 2;\nexport const café = 'ü';\n");
  writeFileSync(join(dir, "src/b.ts"), "export const b = 1;\n");
  sh("add", ".");
  sh("commit", "-q", "-m", "second");
  return dir;
}

const REPO = new URL("../../../", import.meta.url);

/** Every `.ts` file under a source directory of this repo, with its text. */
function sourceFiles(dir: string): Array<[string, string]> {
  const root = new URL(dir, REPO);
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((file) => file.endsWith(".ts"))
    .map((file) => [`${dir}${file}`, readFileSync(new URL(file, root), "utf8")]);
}

describe("@pharn-ci/node-io Node helpers", () => {
  it("AC-2: streamed and whole-text git return the command's stdout, and a failing git call rejects", async () => {
    const { streamGit, runGit } = await import("../src/index.js");
    const dir = gitRepo();

    for (const args of [["log", "--format=%s"], ["diff", "HEAD~1", "HEAD"], ["ls-files"]]) {
      const expected = execFileSync("git", args, { cwd: dir, encoding: "utf8" });
      expect(expected.trim()).not.toBe("");
      expect(await drain(streamGit(dir, args)), args.join(" ")).toBe(expected);
      expect(await runGit(dir, args), args.join(" ")).toBe(expected);
    }

    // A revision that does not exist: both reject with an Error carrying git's own error text.
    const missing = ["diff", "no-such-base", "HEAD"];
    const direct = spawnSync("git", missing, { cwd: dir, encoding: "utf8" });
    expect(direct.status).not.toBe(0);
    expect(direct.stderr.trim()).not.toBe("");
    const streamed = await caught(drain(streamGit(dir, missing)));
    expect(streamed).toBeInstanceOf(Error);
    expect(streamed.message).toContain(direct.stderr.trim());
    const whole = await caught(runGit(dir, missing));
    expect(whole).toBeInstanceOf(Error);
    expect(whole.message).toContain(direct.stderr.trim());

    // A git command that does not finish: `git hash-object --stdin` waits on stdin until the timer kills it.
    const slowStream = await caught(drain(streamGit(dir, ["hash-object", "--stdin"], 100)));
    expect(slowStream).toBeInstanceOf(Error);
    expect(slowStream.message).toContain("timed out after 0.1 s");
    const slowWhole = await caught(runGit(dir, ["hash-object", "--stdin"], 100));
    expect(slowWhole).toBeInstanceOf(Error);
    expect(slowWhole.message).toContain("timed out after 0.1 s");
  }, 60_000);

  it("AC-2: readFile and the file stream return the file's text, and null for a missing file", async () => {
    const { readFile, readFileStream } = await import("../src/index.js");
    const dir = tempDir("pharn-ci-node-io-files-");
    const path = join(dir, "lcov.info");
    // Larger than one read-stream chunk, with multi-byte characters, so the stream arrives in several pieces.
    const text = `TN:\n${Array.from({ length: 20_000 }, (_, i) => `SF:src/ünï-${i}.ts\nDA:1,${i % 3}\nend_of_record`).join("\n")}\n`;
    writeFileSync(path, text, "utf8");

    expect(await readFile(path)).toBe(text);
    const chunks = await readFileStream(path);
    expect(chunks).not.toBeNull();
    expect(await drain(chunks as AsyncIterable<string>)).toBe(text);

    expect(await readFile(join(dir, "missing.info"))).toBeNull();
    expect(await readFileStream(join(dir, "missing.info"))).toBeNull();
  });

  it("AC-2: listDir returns the entries with their kinds, and null for a missing directory", async () => {
    const { listDir } = await import("../src/index.js");
    const dir = tempDir("pharn-ci-node-io-list-");
    writeFileSync(join(dir, "file.info"), "TN:\n");
    mkdirSync(join(dir, "sub"));
    symlinkSync(join(dir, "sub"), join(dir, "link"));

    const entries = await listDir(dir);
    expect(entries).not.toBeNull();
    const sorted = [...(entries ?? [])].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    expect(sorted).toEqual([
      { name: "file.info", kind: "file" },
      { name: "link", kind: "symlink" },
      { name: "sub", kind: "directory" },
    ]);

    expect(await listDir(join(dir, "missing"))).toBeNull();
    expect(await listDir(join(dir, "file.info"))).toBeNull();
  });

  it("AC-2: GIT_TIMEOUT_MS is 120000", async () => {
    const { GIT_TIMEOUT_MS } = await import("../src/index.js");
    expect(GIT_TIMEOUT_MS).toBe(120_000);
  });

  it("AC-2: the CLI and the Action no longer spawn, read or list on their own, nor carry the chunk helpers", async () => {
    // Read inside the body like the other checks; the package must exist for the helpers to have moved there.
    const { readCoverageFiles } = await import("../src/index.js");
    expect(typeof readCoverageFiles).toBe("function");

    const sources = [...sourceFiles("packages/cli/src/"), ...sourceFiles("packages/action/src/")];
    expect(sources.map(([file]) => file)).toEqual(
      expect.arrayContaining(["packages/cli/src/main.ts", "packages/action/src/run.ts"]),
    );
    for (const [file, text] of sources) {
      for (const call of ["spawn(", "execFile(", "readdir(", "createReadStream("]) {
        expect(text.includes(call), `${file} contains ${call}`).toBe(false);
      }
    }

    for (const file of ["packages/cli/src/main.ts", "packages/action/src/run.ts"]) {
      const text = readFileSync(new URL(file, REPO), "utf8");
      for (const helper of ["function* oneChunk", "function streamGit", "function openFile"]) {
        expect(text.includes(helper), `${file} contains ${helper}`).toBe(false);
      }
    }
  });
});
