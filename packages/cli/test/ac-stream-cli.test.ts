import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION } from "../../core/src/version.js";

// main() is loaded inside each test body: the AC tests are written before the CLI streams its diff and coverage
// files, so nothing that depends on that may run while the file loads. The CLI runs against in-memory deps: a fake
// repo rooted at REPO_ROOT whose git returns the golden files list.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

/**
 * fixtures/golden/report.json as this build reports it. The golden file is shared with core tests that pass version
 * "0.1.0" to check(); the CLI and the Action report the package VERSION, so tool.version is the only field set here.
 */
const goldenReport = () => {
  const golden = JSON.parse(fixture("golden/report.json"));
  return { ...golden, tool: { ...golden.tool, version: VERSION } };
};

const REPO_ROOT = "/home/runner/work/demo/demo";
const COVERAGE = "coverage/lcov.info";

/** Cuts `text` into chunks of `size` characters (the last one may be shorter). */
function cut(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let at = 0; at < text.length; at += size) chunks.push(text.slice(at, at + size));
  return chunks;
}

async function* stream(chunks: readonly string[]): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk;
}

/** git's whole-text answers for everything but the diff. */
function wholeTextGit(diff: string | null) {
  const tracked = fixture("golden/files.txt").trim().split("\n");
  return async (args: string[]) => {
    if (args[0] === "ls-files") return `${tracked.join("\0")}\0`;
    if (args[0] === "ls-tree") return "";
    if (args[0] === "rev-parse") return `${REPO_ROOT}\n`;
    if (args[0] === "diff") {
      if (diff === null) throw new Error("the whole-text git call was used for the diff");
      return diff;
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

interface Repo {
  /** Whole-file reads: path relative to REPO_ROOT -> text. A path listed in `rejectRead` rejects instead. */
  files?: Record<string, string>;
  rejectRead?: string[];
  /** Streamed reads: path relative to REPO_ROOT -> chunks. Absent: no readFileStream dep. */
  streams?: Record<string, readonly string[]>;
  /** Whole-text diff, or null to reject any whole-text `git diff`. */
  diff: string | null;
  /** Streamed diff chunks. Absent: no gitStream dep. */
  diffStream?: readonly string[];
}

async function runCli(argv: string[], repo: Repo) {
  const { main } = await import("../src/main.js");
  const out: string[] = [];
  const err: string[] = [];
  const at = (path: string) => resolve(REPO_ROOT, path);
  const files = new Map(Object.entries(repo.files ?? {}).map(([path, text]) => [at(path), text]));
  const rejected = new Set((repo.rejectRead ?? []).map(at));
  const streams = new Map(Object.entries(repo.streams ?? {}).map(([path, chunks]) => [at(path), chunks]));
  const streamCalls: string[][] = [];

  const deps: Record<string, unknown> = {
    cwd: REPO_ROOT,
    git: wholeTextGit(repo.diff),
    readFile: async (path: string) => {
      if (rejected.has(path)) throw new Error(`the whole-file read was used for ${path}`);
      return files.get(path) ?? null;
    },
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
  };
  if (repo.streams !== undefined) {
    deps.readFileStream = async (path: string) => {
      const chunks = streams.get(path);
      return chunks === undefined ? null : stream(chunks);
    };
  }
  if (repo.diffStream !== undefined) {
    const chunks = repo.diffStream;
    deps.gitStream = (args: string[]) => {
      streamCalls.push(args);
      if (args[0] !== "diff") throw new Error(`unexpected streamed git ${args.join(" ")}`);
      return stream(chunks);
    };
  }

  const code = await main(argv, deps as never);
  const stderr = err.join("");
  return {
    code,
    stdout: out.join(""),
    stderr,
    streamCalls,
    formatLines: stderr.split("\n").filter((line) => line.startsWith("coverage: ")),
  };
}

describe("pharn-ci check with streamed inputs", () => {
  it("AC-7: a diff and an lcov file arriving as small chunks give the golden report and exit code", async () => {
    // The golden diff with CRLF endings, cut so that one chunk ends with a CR and the next starts with its LF.
    const crlfDiff = fixture("golden/pr.diff").replace(/\n/g, "\r\n");
    const firstCr = crlfDiff.indexOf("\r");
    const diffChunks = [crlfDiff.slice(0, firstCr + 1), ...cut(crlfDiff.slice(firstCr + 1), 5)];
    expect(diffChunks[0]?.endsWith("\r")).toBe(true);
    expect(diffChunks[1]?.startsWith("\n")).toBe(true);
    expect(diffChunks.join("")).toBe(crlfDiff);

    const coverageChunks = cut(fixture("golden/coverage.info"), 7);

    const golden = goldenReport();
    const run = await runCli(["check", "--coverage", COVERAGE, "--threshold", "80", "--format", "json"], {
      rejectRead: [COVERAGE],
      streams: { [COVERAGE]: coverageChunks },
      diff: null,
      diffStream: diffChunks,
    });

    expect(run.stderr).not.toContain("whole-text git call");
    expect(run.stderr).not.toContain("whole-file read");
    // The golden verdict is fail, which the CLI reports with exit code 1.
    expect(golden.verdict).toBe("fail");
    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout)).toEqual(golden);
    expect(run.streamCalls.filter((args) => args[0] === "diff")).toHaveLength(1);
  });

  it("AC-10: format detection over one-character chunks gives the format line and report of the whole-text read", async () => {
    const record = "TN:\nSF:src/math.ts\nDA:3,1\nDA:4,0\nend_of_record\n";
    const cases = [
      { label: "1,000 spaces then the end", text: " ".repeat(1000), format: "empty" },
      { label: "2,000 spaces then an lcov record", text: `${" ".repeat(2000)}${record}`, format: "unknown" },
      { label: "a byte order mark then an lcov record", text: `﻿${record}`, format: "lcov" },
      { label: "1,000 spaces then an lcov record", text: `${" ".repeat(1000)}${record}`, format: "lcov" },
    ] as const;
    const diff = fixture("golden/pr.diff");
    const argv = ["check", "--coverage", COVERAGE, "--threshold", "80", "--format", "json"];

    for (const { label, text, format } of cases) {
      const whole = await runCli(argv, { files: { [COVERAGE]: text }, diff });
      const streamed = await runCli(argv, {
        rejectRead: [COVERAGE],
        streams: { [COVERAGE]: [...text] },
        diff,
      });

      expect(whole.formatLines, `${label} (whole text)`).toEqual([`coverage: ${format} (auto-detected)`]);
      expect(streamed.stderr, label).not.toContain("whole-file read");
      expect(streamed.formatLines, label).toEqual(whole.formatLines);
      expect(streamed.code, label).toBe(whole.code);
      expect(streamed.stdout, label).not.toBe("");
      expect(JSON.parse(streamed.stdout), label).toEqual(JSON.parse(whole.stdout));
    }
  });
});
