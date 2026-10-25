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

const SLOW = 30_000;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository with `files` committed on `main` and a checked-out `feature` branch with nothing on it yet. */
function featureRepo(files: Record<string, string> = { "README.md": "# demo\n" }) {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-test-sources-drops-")));
  dirs.push(dir);
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  const write = (path: string, content: string | Uint8Array) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", "feature");
  const commit = (message: string) => {
    sh("add", "-A");
    sh("commit", "-q", "-m", message);
  };
  return { dir, sh, write, commit };
}

async function load() {
  const { readTestSources } = (await import("../src/index.js")) as unknown as { readTestSources: Reader };
  const io = (await import("../src/io.js")) as unknown as {
    runGit(cwd: string, args: string[]): Promise<string>;
    runGitBatch(cwd: string, args: string[], input: string): Promise<Uint8Array>;
  };
  const diffOf = async (dir: string) => parseUnifiedDiff(await io.runGit(dir, gitDiffArgs("main")));
  const read = (dir: string, diff: readonly unknown[]) =>
    readTestSources(
      { git: (args) => io.runGit(dir, args), gitBatch: (args, input) => io.runGitBatch(dir, args, input) },
      { base: "main", head: "HEAD", diff },
    );
  return { read, diffOf };
}

function sideOf(side: Side): { files: SourceFile[]; dropped: Drop[] } {
  if ("unavailable" in side) throw new Error(`side is unavailable: ${side.unavailable}`);
  return side;
}

describe("readTestSources: dropped files", () => {
  it(
    "AC-8: drops a file with a NUL byte and one that is not UTF-8 as binary, and keeps multi-byte UTF-8 exactly",
    async () => {
      const { read, diffOf } = await load();
      const r = featureRepo();
      const utf8 = "zażółć 🙂\n";
      r.write("tests/nul.test.ts", Uint8Array.from([0x61, 0x00, 0x62, 0x0a]));
      r.write("tests/ff.test.ts", Uint8Array.from([0x61, 0xff, 0x62, 0x0a]));
      r.write("tests/utf8.test.ts", Buffer.from(utf8, "utf8"));
      r.commit("add three tests");

      const head = sideOf((await read(r.dir, await diffOf(r.dir))).head);

      expect(head.dropped).toContainEqual({ path: "tests/nul.test.ts", reason: "binary" });
      expect(head.dropped).toContainEqual({ path: "tests/ff.test.ts", reason: "binary" });
      const held = head.files.map((f) => f.path);
      expect(held).not.toContain("tests/nul.test.ts");
      expect(held).not.toContain("tests/ff.test.ts");
      expect(head.files.find((f) => f.path === "tests/utf8.test.ts")?.text).toBe(utf8);
    },
    SLOW,
  );

  it(
    "AC-9: records a submodule gitlink and a path absent at both revisions as missing, without throwing",
    async () => {
      const { read, diffOf } = await load();
      const r = featureRepo();
      const ok = "export const ok = true;\n";
      r.write("tests/ok.test.ts", ok);
      r.sh("add", "tests/ok.test.ts");
      // A gitlink with no .gitmodules entry and no object behind it; `git add -A` would drop it, so commit the index.
      r.sh("update-index", "--add", "--cacheinfo", `160000,${"1234567890abcdef".repeat(2)}12345678,tests/sub`);
      r.sh("commit", "-q", "-m", "add a gitlink and a test");

      const diff = await diffOf(r.dir);
      expect(
        diff.map((f) => f.path),
        "the diff names the gitlink",
      ).toContain("tests/sub");
      const ghost = { path: "tests/ghost.test.ts", oldPath: "tests/ghost.test.ts", status: "modified", addedLines: [] };

      const result = await read(r.dir, [...diff, ghost]);
      const base = sideOf(result.base);
      const head = sideOf(result.head);

      expect(head.dropped).toContainEqual({ path: "tests/sub", reason: "missing" });
      expect(base.dropped).toContainEqual({ path: "tests/ghost.test.ts", reason: "missing" });
      expect(head.dropped).toContainEqual({ path: "tests/ghost.test.ts", reason: "missing" });
      expect(head.files.find((f) => f.path === "tests/ok.test.ts")?.text).toBe(ok);
    },
    SLOW,
  );

  it(
    "AC-10: drops a name with a newline or a tab as unsafe-path, so it can never name another blob",
    async () => {
      const { read, diffOf } = await load();
      const secret = "export const secret = 'do not read me';\n";
      const r = featureRepo({ "src/secret.ts": secret });
      const evil = "tests/evil.test.ts\nHEAD:src/secret.ts";
      const tab = "tests/tab\tname.test.ts";
      const plain = "export const plain = 1;\n";
      r.write(evil, "export const evil = 1;\n");
      r.write(tab, "export const tab = 1;\n");
      r.write("tests/plain.test.ts", plain);
      r.commit("add odd test names");

      const diff = await diffOf(r.dir);
      expect(
        diff.map((f) => f.path),
        "the diff names both odd paths",
      ).toEqual(expect.arrayContaining([evil, tab]));

      const result = await read(r.dir, diff);
      const base = sideOf(result.base);
      const head = sideOf(result.head);

      expect(head.dropped).toContainEqual({ path: evil, reason: "unsafe-path" });
      expect(head.dropped).toContainEqual({ path: tab, reason: "unsafe-path" });
      const held = head.files.map((f) => f.path);
      expect(held).not.toContain(evil);
      expect(held).not.toContain(tab);
      for (const file of [...base.files, ...head.files]) expect(file.text, file.path).not.toBe(secret);
      expect(head.files.find((f) => f.path === "tests/plain.test.ts")?.text).toBe(plain);
    },
    SLOW,
  );
});
