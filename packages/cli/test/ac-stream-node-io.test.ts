import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The CLI's and the Action's Node wiring, and core's line readers, are imported inside each test body: the AC tests
// are written before the streaming deps and the line readers exist, so nothing that depends on them may run while
// the file loads. They run against real files and a real git repository in a temporary directory.

const REPO_ROOT = "/home/runner/work/demo/demo";

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

async function load() {
  const { nodeDeps } = await import("../src/nodeDeps.js");
  const { createNodeIo } = await import("../../action/src/node-io.js");
  const { splitLinesAsync } = await import("../../core/src/lines.js");
  const { parseLcov, parseLcovLinesAsync } = await import("../../core/src/coverage/lcov.js");
  const { parseUnifiedDiff, parseUnifiedDiffLinesAsync } = await import("../../core/src/diff/unified.js");
  const { gitDiffArgs } = await import("../../core/src/inputs.js");
  return {
    nodeDeps,
    createNodeIo,
    splitLinesAsync,
    parseLcov,
    parseLcovLinesAsync,
    parseUnifiedDiff,
    parseUnifiedDiffLinesAsync,
    gitDiffArgs,
  };
}

/** A canonical text form of a coverage map, for a deep comparison that does not depend on insertion order. */
const canonical = (map: Map<string, Map<number, number>>) =>
  JSON.stringify(
    [...map]
      .map(([path, hits]) => [path, [...hits].sort((a, b) => a[0] - b[0])] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  );

/**
 * More than 1 MiB of lcov: a byte order mark, CRLF endings, and many records whose source path holds multi-byte
 * UTF-8 characters. The first line is padded so that the byte at 64 KiB (a read stream's default chunk size) falls
 * inside a multi-byte character, which a read boundary then cuts.
 */
function bigLcov(): Buffer {
  const records: string[] = [];
  for (let i = 0; i < 12_000; i++) {
    const lines = [`SF:${REPO_ROOT}/src/ünïcødé/ファイル-${i}-é.ts`];
    for (let line = 1; line <= 6; line++) lines.push(`DA:${line + (i % 7)},${(i * line) % 5}`);
    lines.push("end_of_record");
    records.push(lines.join("\r\n"));
  }
  const body = `${records.join("\r\n")}\r\n`;
  for (let pad = 0; pad < 400; pad++) {
    const buffer = Buffer.from(`﻿TN:${"x".repeat(pad)}\r\n${body}`, "utf8");
    const byte = buffer[64 * 1024] ?? 0;
    if (byte >= 0x80 && byte <= 0xbf) return buffer;
  }
  throw new Error("could not place a multi-byte character across the 64 KiB boundary");
}

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

describe("the CLI's and the Action's real streaming", () => {
  it("AC-14: a large lcov file with a BOM, CRLF and multi-byte paths, streamed from disk, parses as read whole", async () => {
    const { nodeDeps, createNodeIo, splitLinesAsync, parseLcov, parseLcovLinesAsync } = await load();
    const dir = tempDir("pharn-ci-stream-lcov-");
    const path = join(dir, "lcov.info");
    const bytes = bigLcov();
    expect(bytes.length).toBeGreaterThan(1024 * 1024);
    writeFileSync(path, bytes);

    const whole = readFileSync(path, "utf8");
    expect(whole.startsWith("﻿")).toBe(true);
    const options = { repoRoot: REPO_ROOT };
    const expected = parseLcov(whole, options);
    expect(expected.size).toBe(12_000);
    expect([...expected.keys()].some((key) => key.includes("ファイル") && key.startsWith("src/ünïcødé/"))).toBe(true);

    for (const [label, deps] of [
      ["cli", nodeDeps(dir)],
      ["action", createNodeIo(dir)],
    ] as const) {
      const chunks = await deps.readFileStream(path);
      expect(chunks, label).not.toBeNull();
      const map = await parseLcovLinesAsync(splitLinesAsync(chunks as AsyncIterable<string>), options);
      expect(map.size, label).toBe(expected.size);
      expect(canonical(map), label).toBe(canonical(expected));
    }
  }, 60_000);

  it("AC-15: a real streamed git diff parses as read whole, a missing base rejects with git's error, and the timeout holds", async () => {
    const { nodeDeps, createNodeIo, splitLinesAsync, parseUnifiedDiff, parseUnifiedDiffLinesAsync, gitDiffArgs } =
      await load();
    const dir = tempDir("pharn-ci-stream-git-");
    const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    sh("init", "-q", "-b", "main");
    sh("config", "user.email", "test@example.com");
    sh("config", "user.name", "test");
    sh("config", "commit.gpgsign", "false");
    mkdirSync(join(dir, "src", "old dir"), { recursive: true });
    const numbered = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => `export const v${from + i} = ${from + i};`).join("\n");
    writeFileSync(join(dir, "src/math.ts"), `${numbered(1, 400)}\n`);
    writeFileSync(
      join(dir, "src/old dir/café.ts"),
      "export const old = 1;\nexport const keep = 2;\nexport const x = 3;\n",
    );
    writeFileSync(join(dir, "src/gone.ts"), "export const gone = true;\n");
    sh("add", ".");
    sh("commit", "-q", "-m", "base");
    const base = sh("rev-parse", "HEAD").trim();

    sh("checkout", "-q", "-b", "feature");
    // Several hunks in one file, a rename between paths with a space and a non-ASCII character, a deleted file, and a
    // new file with CRLF endings and a lone CR inside a line.
    const changed = numbered(1, 400)
      .split("\n")
      .map((line, i) => (i % 37 === 5 ? `${line} // changed ${i}` : line))
      .join("\n");
    writeFileSync(join(dir, "src/math.ts"), `${changed}\nexport const tail = 1;\n`);
    mkdirSync(join(dir, "src", "new dir"), { recursive: true });
    sh("mv", "src/old dir/café.ts", "src/new dir/café.ts");
    writeFileSync(
      join(dir, "src/new dir/café.ts"),
      "export const old = 1;\nexport const keep = 2;\nexport const y = 3;\n",
    );
    sh("rm", "-q", "src/gone.ts");
    writeFileSync(join(dir, "src/crlf.ts"), "export const a = 1;\r\nexport const b = 'x\ry';\r\n");
    sh("add", ".");
    sh("commit", "-q", "-m", "feature");

    const args = gitDiffArgs(base);
    for (const [label, deps] of [
      ["cli", nodeDeps(dir)],
      ["action", createNodeIo(dir)],
    ] as const) {
      const expected = parseUnifiedDiff(await deps.git(args));
      expect(expected.length, label).toBeGreaterThanOrEqual(3);
      const streamed = await parseUnifiedDiffLinesAsync(splitLinesAsync(deps.gitStream(args)));
      expect(streamed, label).toEqual(expected);
    }

    // A base that does not exist: the streamed call rejects with git's own error text.
    const missing = gitDiffArgs("no-such-base");
    const direct = spawnSync("git", missing, { cwd: dir, encoding: "utf8" });
    expect(direct.status).not.toBe(0);
    expect(direct.stderr.trim()).not.toBe("");
    for (const [label, deps] of [
      ["cli", nodeDeps(dir)],
      ["action", createNodeIo(dir)],
    ] as const) {
      const err = await caught(drain(deps.gitStream(missing)));
      expect(err, label).toBeInstanceOf(Error);
      expect(err.message, label).toContain(direct.stderr.trim());
    }

    // A git command that does not finish: `git hash-object --stdin` waits on stdin until the timer kills it.
    for (const [label, deps] of [
      ["cli", nodeDeps(dir, { gitTimeoutMs: 100 })],
      ["action", createNodeIo(dir, { gitTimeoutMs: 100 })],
    ] as const) {
      const err = await caught(drain(deps.gitStream(["hash-object", "--stdin"])));
      expect(err, label).toBeInstanceOf(Error);
      expect(err.message, label).toContain("timed out after 0.1 s");
    }
  }, 60_000);
});
