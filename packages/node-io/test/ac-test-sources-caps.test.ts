import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitDiffArgs, parseUnifiedDiff } from "../../core/src/index.js";

// readTestSources and runGitBatch are loaded inside each test body: these tests are written before they exist, so
// nothing that depends on them may run while the file loads. Each test builds a real git repository whose feature
// branch adds the files, and reads them with the real git runners.

type SourceFile = { path: string; text: string };
type Drop = { path: string; reason: string };
type Side = { unavailable: string } | { files: SourceFile[]; dropped: Drop[] };
type Sources = { base: Side; head: Side };
type Reader = (
  deps: { git(args: string[]): Promise<string>; gitBatch(args: string[], input: string): Promise<Uint8Array> },
  options: { base: string; head?: string; diff: readonly unknown[] },
) => Promise<Sources>;

const SLOW = 120_000;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository with one commit on `main` and a checked-out `feature` branch with nothing on it yet. */
function featureRepo() {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-test-sources-caps-")));
  dirs.push(dir);
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "# demo\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", "feature");
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const commit = (message: string) => {
    sh("add", "-A");
    sh("commit", "-q", "-m", message);
  };
  // The diff of a large change is read here with a large buffer: the test provides the parsed diff, the reader is
  // what is under test.
  const diff = () =>
    parseUnifiedDiff(
      execFileSync("git", gitDiffArgs("main"), { cwd: dir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }),
    );
  return { dir, write, commit, diff };
}

async function load() {
  const { readTestSources } = (await import("../src/index.js")) as unknown as { readTestSources: Reader };
  const io = (await import("../src/io.js")) as unknown as {
    runGit(cwd: string, args: string[]): Promise<string>;
    runGitBatch(cwd: string, args: string[], input: string): Promise<Uint8Array>;
  };
  return (dir: string, diff: readonly unknown[]) =>
    readTestSources(
      { git: (args) => io.runGit(dir, args), gitBatch: (args, input) => io.runGitBatch(dir, args, input) },
      { base: "main", head: "HEAD", diff },
    );
}

function sideOf(side: Side): { files: SourceFile[]; dropped: Drop[] } {
  if ("unavailable" in side) throw new Error(`side is unavailable: ${side.unavailable}`);
  return side;
}

/** Exactly `bytes` ASCII bytes, in 64-byte lines, the first line naming `label`. */
function sized(bytes: number, label: string): string {
  const line = `// ${label} `.padEnd(63, "x").slice(0, 63);
  const lines = Math.floor(bytes / 64);
  const text = `${line}\n`.repeat(lines);
  return text + "y".repeat(bytes - lines * 64);
}

/** A fixed-seed shuffle, so the run is repeatable. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  let seed = 12345;
  for (let i = out.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const pad3 = (n: number) => String(n).padStart(3, "0");
const pad2 = (n: number) => String(n).padStart(2, "0");

describe("readTestSources: the caps", () => {
  it(
    "AC-5: reads a file of exactly 512 KiB and drops one byte more as too-large, with no text",
    async () => {
      const read = await load();
      const r = featureRepo();
      const exact = sized(524288, "exact");
      const over = sized(524289, "over");
      expect(Buffer.byteLength(exact)).toBe(524288);
      expect(Buffer.byteLength(over)).toBe(524289);
      r.write("tests/exact.test.ts", exact);
      r.write("tests/over.test.ts", over);
      r.commit("add two large tests");

      const head = sideOf((await read(r.dir, r.diff())).head);

      expect(head.files.find((f) => f.path === "tests/exact.test.ts")?.text).toBe(exact);
      expect(head.dropped).toContainEqual({ path: "tests/over.test.ts", reason: "too-large" });
      expect(head.files.map((f) => f.path)).not.toContain("tests/over.test.ts");
    },
    SLOW,
  );

  it(
    "AC-6: reads the first 200 paths in code-unit order and drops the rest as over-file-cap, whatever the order",
    async () => {
      const read = await load();
      const r = featureRepo();
      // Created and committed from f204 down to f000, so neither creation nor commit order matches the path order.
      for (let i = 204; i >= 0; i--) {
        r.write(`t/f${pad3(i)}.test.ts`, `export const n = ${i};\n`);
        if (i % 41 === 0) r.commit(`add tests down to f${pad3(i)}`);
      }
      const diff = r.diff();
      expect(diff).toHaveLength(205);

      const first = await read(r.dir, diff);
      const again = await read(r.dir, shuffled(diff));
      const head = sideOf(first.head);

      expect(head.files.map((f) => f.path)).toEqual(Array.from({ length: 200 }, (_, i) => `t/f${pad3(i)}.test.ts`));
      for (const file of head.files) expect(file.text).toBe(`export const n = ${Number(file.path.slice(3, 6))};\n`);
      expect(head.dropped).toEqual(
        [200, 201, 202, 203, 204].map((i) => ({ path: `t/f${pad3(i)}.test.ts`, reason: "over-file-cap" })),
      );
      expect(again).toEqual(first);
    },
    SLOW,
  );

  it(
    "AC-7: drops the file that would pass 16 MiB and every later path as over-total-cap",
    async () => {
      const read = await load();
      const r = featureRepo();
      const big = Array.from({ length: 33 }, (_, i) => `big/b${pad2(i)}.test.ts`);
      for (const path of big) r.write(path, sized(512000, path));
      r.write("zz/small.test.ts", "export const small = 1;\n");
      r.commit("add 33 big tests and a small one");

      const head = sideOf((await read(r.dir, r.diff())).head);

      expect(head.files.map((f) => f.path)).toEqual(big.slice(0, 32));
      for (const file of head.files) expect(file.text).toBe(sized(512000, file.path));
      expect(head.dropped).toEqual([
        { path: "big/b32.test.ts", reason: "over-total-cap" },
        { path: "zz/small.test.ts", reason: "over-total-cap" },
      ]);
    },
    SLOW,
  );
});
