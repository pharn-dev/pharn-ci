import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitDiffArgs, parseUnifiedDiff } from "../../core/src/index.js";

// readTestSources and runGitBatch are loaded inside the test body: this test is written before they exist, so
// nothing that depends on them may run while the file loads. It runs against a real git repository in a temporary
// directory, built with git as packages/node-io/test/git-allowlist.test.ts builds one.

type SourceFile = { path: string; text: string };
type Side = { unavailable: string } | { files: SourceFile[]; dropped: { path: string; reason: string }[] };
type Sources = { base: Side; head: Side };
type Reader = (
  deps: { git(args: string[]): Promise<string>; gitBatch(args: string[], input: string): Promise<Uint8Array> },
  options: { base: string; head?: string; diff: readonly unknown[] },
) => Promise<Sources>;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo() {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-test-sources-read-")));
  dirs.push(dir);
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const commit = (message: string) => {
    sh("add", "-A");
    sh("commit", "-q", "-m", message);
  };
  return { dir, sh, write, commit, remove: (path: string) => unlinkSync(join(dir, path)) };
}

async function load() {
  const { readTestSources } = (await import("../src/index.js")) as unknown as { readTestSources: Reader };
  const io = (await import("../src/io.js")) as unknown as {
    runGit(cwd: string, args: string[]): Promise<string>;
    runGitBatch(cwd: string, args: string[], input: string): Promise<Uint8Array>;
  };
  return { readTestSources, runGit: io.runGit, runGitBatch: io.runGitBatch };
}

function sideOf(side: Side): { files: SourceFile[]; dropped: { path: string; reason: string }[] } {
  if ("unavailable" in side) throw new Error(`side is unavailable: ${side.unavailable}`);
  return side;
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

describe("readTestSources: base and head text from git", () => {
  it("AC-4: reads the base side at the merge base and the head side at HEAD, per path, and drops nothing", async () => {
    const { readTestSources, runGit, runGitBatch } = await load();
    const r = repo();

    // Rename detection needs most of the renamed file to stay the same.
    const renamedBody = Array.from({ length: 20 }, (_, i) => `it("case ${i}", () => expect(${i}).toBe(${i}));\n`).join(
      "",
    );
    const atBranchPoint: Record<string, string> = {
      "tests/mod.test.ts": "export const modified = 'at the branch point';\n",
      "tests/del.test.ts": "export const deleted = 'at the branch point';\n",
      "tests/ren.test.ts": `// before the rename\n${renamedBody}`,
      "tests/with space.test.ts": "export const spaced = 'at the branch point';\n",
      "vitest.config.ts": "export default { test: { include: ['tests/**'] } };\n",
      "src/index.ts": "export const index = 1;\n",
    };
    for (const [path, text] of Object.entries(atBranchPoint)) r.write(path, text);
    r.commit("base");

    r.sh("checkout", "-q", "-b", "feature");
    const atHead: Record<string, string> = {
      "tests/mod.test.ts": "export const modified = 'on the feature branch';\n",
      "tests/renamed.test.ts": `// after the rename\n${renamedBody}`,
      "tests/with space.test.ts": "export const spaced = 'on the feature branch';\n",
      "src/new.test.ts": "export const added = 'on the feature branch';\n",
      "vitest.config.ts": "export default { test: { include: ['tests/**', 'src/**'] } };\n",
    };
    r.remove("tests/del.test.ts");
    r.sh("mv", "tests/ren.test.ts", "tests/renamed.test.ts");
    for (const [path, text] of Object.entries(atHead)) r.write(path, text);
    r.write("src/index.ts", "export const index = 2;\n");
    r.commit("feature");

    // main moves on after the branch point: the base side must not read this text.
    r.sh("checkout", "-q", "main");
    r.write("tests/mod.test.ts", "export const modified = 'on main after the branch point';\n");
    r.commit("main later");
    r.sh("checkout", "-q", "feature");

    const dir = r.dir;
    const diff = parseUnifiedDiff(await runGit(dir, gitDiffArgs("main")));
    expect(diff.find((f) => f.path === "tests/renamed.test.ts")?.status, "the diff sees the rename").toBe("renamed");

    const result = await readTestSources(
      { git: (args) => runGit(dir, args), gitBatch: (args, input) => runGitBatch(dir, args, input) },
      { base: "main", head: "HEAD", diff },
    );
    const base = sideOf(result.base);
    const head = sideOf(result.head);

    const expectedBase = [
      "tests/del.test.ts",
      "tests/mod.test.ts",
      "tests/ren.test.ts",
      "tests/with space.test.ts",
      "vitest.config.ts",
    ].map((path) => ({ path, text: atBranchPoint[path] as string }));
    const expectedHead = Object.entries(atHead).map(([path, text]) => ({ path, text }));

    expect([...base.files].sort(byPath)).toEqual(expectedBase.sort(byPath));
    expect([...head.files].sort(byPath)).toEqual(expectedHead.sort(byPath));
    expect(base.files.map((f) => f.path)).not.toContain("src/new.test.ts");
    expect(head.files.map((f) => f.path)).not.toContain("tests/del.test.ts");
    for (const side of [base, head]) {
      expect(side.files.map((f) => f.path)).not.toContain("src/index.ts");
      expect(side.dropped.map((d) => d.path)).not.toContain("src/index.ts");
    }
    expect(base.dropped).toEqual([]);
    expect(head.dropped).toEqual([]);
  });
});
