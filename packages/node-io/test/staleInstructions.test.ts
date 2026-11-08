import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type DiffFile, detectStaleInstructions, scanAgentSetup } from "../../core/src/index.js";
import { runGit, runGitBatch } from "../src/io.js";
import { readStaleInstructionSources } from "../src/staleInstructions.js";

// Stale instructions (Horizon 2 item H3): the node-io reader against a real repository. The base commit is dated two
// years before the feature commit, so AGENTS.md is old for SI04; the feature branch removes the `format` script.

let dir: string;
const OLD = "2024-01-01T00:00:00Z";
const NEW = "2026-01-01T00:00:00Z";

function sh(args: string[], date?: string): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...(date === undefined ? {} : { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) },
  });
}

function write(path: string, text: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

const PACKAGE = (scripts: Record<string, string>) => `${JSON.stringify({ name: "x", scripts }, null, 2)}\n`;

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-stale-reader-")));
  sh(["init", "-q", "-b", "main"]);
  sh(["config", "user.email", "test@example.com"]);
  sh(["config", "user.name", "test"]);
  sh(["config", "commit.gpgsign", "false"]);
  write("AGENTS.md", "The entry point is `src/index.ts`.\n");
  write("CLAUDE.md", "Format with `pnpm format` and build with `make build`.\n");
  write("package.json", PACKAGE({ build: "tsc", format: "biome format" }));
  write("Makefile", "build:\n\techo build\n");
  write("src/index.ts", "export const a = 1;\n");
  sh(["add", "-A"]);
  sh(["commit", "-q", "-m", "base"], OLD);
  sh(["checkout", "-q", "-b", "feature"]);
  write("package.json", PACKAGE({ build: "tsc" }));
  write("src/index.ts", "export const a = 2;\n");
  sh(["add", "-A"]);
  sh(["commit", "-q", "-m", "feature"], NEW);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const DIFF: DiffFile[] = [
  { path: "package.json", oldPath: "package.json", status: "modified", addedLines: [] },
  { path: "src/index.ts", oldPath: "src/index.ts", status: "modified", addedLines: [1] },
];
const repoFiles = () => sh(["ls-files"]).split("\n").filter(Boolean);
const deps = () => ({
  gitBatch: (args: string[], input: string) => runGitBatch(dir, args, input),
  git: (args: string[]) => runGit(dir, args),
});

describe("readStaleInstructionSources", () => {
  it("reads the instruction files at HEAD, the touched package.json at the merge base too, and SI04's commit times", async () => {
    const files = repoFiles();
    const sources = await readStaleInstructionSources(deps(), { repoFiles: files, diff: DIFF, base: "main" });
    expect(sources).toBeDefined();
    if (sources === undefined || "unavailable" in sources.instructions) throw new Error("no sources");
    expect(sources.instructions.files.map((f) => f.path)).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(sources.packageJson?.head).toContain('"build"');
    expect(sources.packageJson?.head).not.toContain('"format"');
    expect(sources.packageJson?.base).toContain('"format"');
    expect(sources.makefile).toEqual({ head: "build:\n\techo build\n" });
    expect(sources.commitTimes).toEqual({
      head: Date.parse(NEW) / 1000,
      files: [{ path: "AGENTS.md", time: Date.parse(OLD) / 1000 }],
    });

    // Through the detector: the removed script (SI01) and the old AGENTS.md (SI04).
    const { findings } = detectStaleInstructions({
      sources,
      diff: DIFF,
      repoFiles: files,
      agentSetup: scanAgentSetup(files),
    });
    expect(findings.map((f) => `${f.id} ${f.path}:${f.line} ${f.token}`)).toEqual([
      "SI04 AGENTS.md:1 src/index.ts",
      "SI01 CLAUDE.md:1 pnpm run format",
    ]);
  });

  it("reads nothing without instruction files; without a git runner it has no times and no base side", async () => {
    expect(await readStaleInstructionSources(deps(), { repoFiles: ["src/index.ts"], diff: DIFF })).toBeUndefined();
    const batchOnly = await readStaleInstructionSources(
      { gitBatch: deps().gitBatch },
      { repoFiles: repoFiles(), diff: DIFF, base: "main" },
    );
    expect(batchOnly?.commitTimes).toBeUndefined();
    expect(batchOnly?.packageJson).toEqual({ head: expect.stringContaining('"build"') });
  });

  it("a failing batch git leaves the instructions unavailable; a failing git log leaves the times out", async () => {
    const failing = await readStaleInstructionSources(
      { gitBatch: () => Promise.reject(new Error("fatal: simulated")) },
      { repoFiles: repoFiles(), diff: DIFF },
    );
    expect(failing?.instructions).toEqual({
      unavailable: expect.stringContaining("git cat-file --batch-check failed"),
    });
    const noLog = await readStaleInstructionSources(
      {
        gitBatch: deps().gitBatch,
        git: (args) => (args[0] === "log" ? Promise.reject(new Error("fatal: log")) : runGit(dir, args)),
      },
      { repoFiles: repoFiles(), diff: DIFF, base: "main" },
    );
    expect(noLog?.commitTimes).toBeUndefined();
    expect(noLog?.packageJson?.base).toContain('"format"');
  });

  it("names each timed path as a top-level literal pathspec after --, and never asks for an unsafe path", async () => {
    const calls: string[][] = [];
    await readStaleInstructionSources(
      {
        gitBatch: deps().gitBatch,
        git: (args) => {
          calls.push(args);
          return runGit(dir, args);
        },
      },
      { repoFiles: repoFiles(), diff: DIFF, base: "main" },
    );
    expect(calls).toEqual([
      ["merge-base", "main", "HEAD"],
      ["log", "-1", "--format=%ct", "HEAD"],
      ["log", "-1", "--format=%ct", "HEAD", "--", ":(top,literal)AGENTS.md"],
    ]);
    const dashed = await readStaleInstructionSources(
      { gitBatch: deps().gitBatch, git: (args) => runGit(dir, args) },
      { repoFiles: repoFiles(), diff: DIFF, base: "--output=x" },
    );
    expect(dashed?.packageJson?.base).toBeUndefined();
  });
});
