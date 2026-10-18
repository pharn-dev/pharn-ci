import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// main() and run() are loaded inside each test body: the AC tests are written before the CLI and the Action stream
// their diff and coverage files, so nothing that depends on that may run while the file loads. Both run against
// in-memory deps: a fake repo rooted at REPO_ROOT whose git returns the golden files list.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const REPO_ROOT = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const COVERAGE = "coverage/lcov.info";

/** Cuts `text` into chunks of `size` characters (the last one may be shorter). */
function cut(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let at = 0; at < text.length; at += size) chunks.push(text.slice(at, at + size));
  return chunks;
}

/** A source of text chunks: a fixed list, then an optional error thrown after them. */
interface ChunkSource {
  chunks: readonly string[];
  error?: Error;
  /** Set once the consumer pulled past the last chunk (so the error, if any, was reached). */
  reachedEnd?: boolean;
}

function fromSource(source: ChunkSource): AsyncIterable<string> {
  return (async function* () {
    for (const chunk of source.chunks) yield chunk;
    source.reachedEnd = true;
    if (source.error) throw source.error;
  })();
}

/**
 * A stream that starts with 1 KiB of text that is neither lcov nor XML and never ends. As a guard, so that a reader
 * which reads it to the end fails instead of hanging, it throws after 20,000 chunks (about 20 MiB).
 */
function endless(state: { pulled: number }): AsyncIterable<string> {
  const filler = "this is not a coverage report; ".repeat(40).slice(0, 1024);
  return (async function* () {
    for (;;) {
      state.pulled++;
      if (state.pulled > 20_000) throw new Error("the endless coverage stream was read past its start");
      yield filler;
      // Let timers run between chunks, so a test timeout can still fire.
      await new Promise((done) => setImmediate(done));
    }
  })();
}

const ioError = () => Object.assign(new Error("EIO: i/o error, read"), { code: "EIO", errno: -5, syscall: "read" });
const dirError = (path: string) =>
  Object.assign(new Error(`EISDIR: illegal operation on a directory, read '${path}'`), {
    code: "EISDIR",
    errno: -21,
    syscall: "read",
  });

interface Fakes {
  /** Whole-file reads: path relative to REPO_ROOT -> text, or an error to reject with. */
  files?: Record<string, string | Error>;
  /** Streamed reads: path relative to REPO_ROOT -> a chunk source, or an error to reject with. */
  streams?: Record<string, ChunkSource | Error | (() => AsyncIterable<string>)>;
  /** Whole-text diff, or an error to reject with. */
  diff: string | Error;
  /** Streamed diff, or absent for no gitStream dep. */
  diffStream?: ChunkSource;
}

function commonDeps(fakes: Fakes) {
  const at = (path: string) => resolve(REPO_ROOT, path);
  const files = new Map(Object.entries(fakes.files ?? {}).map(([path, value]) => [at(path), value]));
  const streams = new Map(Object.entries(fakes.streams ?? {}).map(([path, value]) => [at(path), value]));
  const tracked = fixture("golden/files.txt").trim().split("\n");
  const streamCalls: string[][] = [];

  const deps: Record<string, unknown> = {
    git: async (args: string[]) => {
      if (args[0] === "ls-files") return `${tracked.join("\0")}\0`;
      if (args[0] === "ls-tree") return "";
      if (args[0] === "diff") {
        if (fakes.diff instanceof Error) throw fakes.diff;
        return fakes.diff;
      }
      if (args[0] === "rev-parse" && args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return `${HEAD_SHA}\n`;
      return `${BASE_SHA}\n`;
    },
    readFile: async (path: string) => {
      const value = files.get(path);
      if (value instanceof Error) throw value;
      return value ?? null;
    },
    readFileStream: async (path: string) => {
      const value = streams.get(path);
      if (value === undefined) return null;
      if (value instanceof Error) throw value;
      if (typeof value === "function") return value();
      return fromSource(value);
    },
    resolvePath: (...segments: string[]) => resolve(...segments),
  };
  if (fakes.diffStream !== undefined) {
    const source = fakes.diffStream;
    deps.gitStream = (args: string[]) => {
      streamCalls.push(args);
      if (args[0] !== "diff") throw new Error(`unexpected streamed git ${args.join(" ")}`);
      return fromSource(source);
    };
  }
  return { deps, streamCalls };
}

async function runCli(argv: string[], fakes: Fakes) {
  const { main } = await import("../src/main.js");
  const out: string[] = [];
  const err: string[] = [];
  const { deps, streamCalls } = commonDeps(fakes);
  Object.assign(deps, {
    cwd: REPO_ROOT,
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
  });
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

// What the runner passes when an input is not set: the action.yml default, else "".
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "false",
  "fail-on-threshold": "true",
  config: "",
};

async function runAction(inputs: Record<string, string>, fakes: Fakes & { compare: string | Error }) {
  const { run } = await import("../../action/src/run.js");
  const failed: string[] = [];
  const infos: string[] = [];
  const outputs: Record<string, string> = {};
  const written = new Map<string, string>();
  const compareCalls: string[] = [];
  const { deps, streamCalls } = commonDeps(fakes);
  Object.assign(deps, {
    getInput: (name: string) => inputs[name] ?? INPUT_DEFAULTS[name] ?? "",
    context: {
      eventName: "pull_request",
      sha: HEAD_SHA,
      ref: "refs/pull/7/merge",
      repo: { owner: "octo", repo: "demo" },
      issue: { owner: "octo", repo: "demo", number: 7 },
      payload: {
        pull_request: {
          number: 7,
          base: { sha: BASE_SHA, ref: "main" },
          head: { sha: HEAD_SHA, ref: "feature" },
        },
      },
    },
    workspace: REPO_ROOT,
    tempDir: "/home/runner/work/_temp",
    api: {
      compareDiff: async (basehead: string) => {
        compareCalls.push(basehead);
        if (fakes.compare instanceof Error) throw fakes.compare;
        return fakes.compare;
      },
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async () => {},
      updateComment: async () => {},
    },
    writeFile: async (path: string, text: string) => {
      written.set(path, text);
    },
    info: (message: string) => {
      infos.push(message);
    },
    warning: () => {},
    setOutput: (name: string, value: unknown) => {
      outputs[name] = String(value);
    },
    setFailed: (message: string) => {
      failed.push(message);
    },
    writeSummary: async () => {},
  });
  await run(deps as never);
  return {
    failed,
    infos,
    outputs,
    compareCalls,
    streamCalls,
    formatLines: infos.filter((line) => line.startsWith("coverage: ")),
    report: () => {
      const text = written.get(outputs["report-path"] ?? "");
      if (text === undefined) throw new Error(`no report written at report-path ${outputs["report-path"]}`);
      return JSON.parse(text);
    },
  };
}

type Message = { level: string; code: string; text: string };

describe("streamed inputs in the CLI and the Action: early stops and failures", () => {
  it("AC-9: a never-ending coverage stream under auto is read only as far as format detection needs", async () => {
    const file = "cov/coverage-unknown.dat";

    const cliState = { pulled: 0 };
    const cli = await runCli(["check", "--coverage", file, "--threshold", "80", "--format", "json"], {
      // A file that never ends cannot be read whole.
      files: { [file]: new Error("the whole-file read was used for a never-ending file") },
      streams: { [file]: () => endless(cliState) },
      diff: fixture("golden/pr.diff"),
    });
    expect(cli.stderr).not.toContain("whole-file read");
    expect(cli.stderr).not.toContain("read past its start");
    expect(cli.code).toBe(1);
    const cliReport = JSON.parse(cli.stdout);
    expectValidReport(cliReport);
    const cliUnsupported = (cliReport.messages as Message[]).filter((m) => m.code === "COVERAGE_FORMAT_UNSUPPORTED");
    expect(cliUnsupported).toHaveLength(1);
    expect(cliUnsupported[0]?.text).toContain(file);
    expect(cli.formatLines).toEqual(["coverage: unknown (auto-detected)"]);
    expect(cliState.pulled).toBeLessThan(20_000);

    const actionState = { pulled: 0 };
    const action = await runAction(
      { "coverage-file": file, threshold: "80" },
      {
        files: { [file]: new Error("the whole-file read was used for a never-ending file") },
        streams: { [file]: () => endless(actionState) },
        diff: fixture("golden/pr.diff"),
        compare: fixture("golden/pr.diff"),
      },
    );
    expect(action.failed.join("\n")).not.toContain("whole-file read");
    expect(action.failed.join("\n")).not.toContain("read past its start");
    const actionReport = action.report();
    expectValidReport(actionReport);
    const actionUnsupported = (actionReport.messages as Message[]).filter(
      (m) => m.code === "COVERAGE_FORMAT_UNSUPPORTED",
    );
    expect(actionUnsupported).toHaveLength(1);
    expect(actionUnsupported[0]?.text).toContain(file);
    expect(action.formatLines).toEqual(["coverage: unknown (auto-detected)"]);
    expect(actionState.pulled).toBeLessThan(20_000);
  });

  it("AC-11: a streamed git diff that fails after valid lines exits 2 in the CLI and falls back to the API in the Action", async () => {
    const golden = fixture("golden/pr.diff");
    const coverage = fixture("golden/coverage.info");

    // CLI: half of the golden diff, then git's failure.
    const cliSource: ChunkSource = {
      chunks: cut(golden.slice(0, Math.floor(golden.length / 2)), 9),
      error: new Error("fatal: bad revision 'origin/main...HEAD'"),
    };
    const cli = await runCli(["check", "--coverage", COVERAGE, "--threshold", "80", "--format", "json"], {
      files: { [COVERAGE]: coverage },
      streams: { [COVERAGE]: { chunks: cut(coverage, 64) } },
      diff: new Error("the whole-text git call was used for the diff"),
      diffStream: cliSource,
    });
    expect(cliSource.reachedEnd).toBe(true);
    expect(cli.code).toBe(2);
    expect(cli.stderr).toContain('could not diff against "origin/main"');
    expect(cli.stderr).toContain("fatal: bad revision 'origin/main...HEAD'");
    expect(cli.stderr).not.toContain("whole-text git call");
    expect(cli.stdout).toBe("");

    // Action: valid lines of a diff the API does not hold, then git's failure; the compare API holds the golden diff.
    const leak = [
      "diff --git a/src/leak.ts b/src/leak.ts",
      "new file mode 100644",
      "index 0000000..4444444",
      "--- /dev/null",
      "+++ b/src/leak.ts",
      "@@ -0,0 +1,3 @@",
      "+export const a = 1;",
      "+export const b = 2;",
      "+export const c = 3;",
      "",
    ].join("\n");
    const actionSource: ChunkSource = { chunks: cut(leak, 9), error: new Error("fatal: bad object") };
    const action = await runAction(
      { "coverage-file": COVERAGE, threshold: "80" },
      {
        files: { [COVERAGE]: coverage },
        streams: { [COVERAGE]: { chunks: cut(coverage, 64) } },
        diff: new Error("the whole-text git call was used for the diff"),
        diffStream: actionSource,
        compare: golden,
      },
    );
    expect(actionSource.reachedEnd).toBe(true);
    expect(action.compareCalls).toHaveLength(1);
    const fallback = action.infos.filter((line) => line.includes("local git diff failed"));
    expect(fallback).toHaveLength(1);
    expect(fallback[0]).toContain("falling back to the GitHub API");
    expect(fallback[0]).not.toContain("whole-text git call");
    // The report is the one for the API diff alone: the golden report, with nothing of the failed local diff.
    expect(action.report()).toEqual(JSON.parse(fixture("golden/report.json")));
  });

  it("AC-13: a coverage stream that fails part-way, or a coverage path that is a directory, is a runtime error", async () => {
    const coverage = fixture("golden/coverage.info");
    const firstRecord = coverage.slice(0, coverage.indexOf("end_of_record") + "end_of_record\n".length);
    const argv = ["check", "--coverage", COVERAGE, "--threshold", "80", "--format", "json"];

    // The whole-file read of the same file succeeds: only the stream fails.
    const brokenCli = await runCli(argv, {
      files: { [COVERAGE]: coverage },
      streams: { [COVERAGE]: { chunks: cut(firstRecord, 16), error: ioError() } },
      diff: fixture("golden/pr.diff"),
    });
    expect(brokenCli.code).toBe(2);
    expect(brokenCli.stderr.startsWith("pharn-ci:")).toBe(true);
    expect(brokenCli.stderr).toContain("EIO");
    expect(brokenCli.stdout).toBe("");

    const dirPath = resolve(REPO_ROOT, COVERAGE);
    const directoryCli = await runCli(argv, {
      files: { [COVERAGE]: dirError(dirPath) },
      streams: { [COVERAGE]: { chunks: [], error: dirError(dirPath) } },
      diff: fixture("golden/pr.diff"),
    });
    expect(directoryCli.code).toBe(2);
    expect(directoryCli.stderr.startsWith("pharn-ci:")).toBe(true);
    expect(directoryCli.stderr).toContain("EISDIR");
    expect(directoryCli.stdout).toBe("");

    const inputs = { "coverage-file": COVERAGE, threshold: "80" };
    const brokenAction = await runAction(inputs, {
      files: { [COVERAGE]: coverage },
      streams: { [COVERAGE]: { chunks: cut(firstRecord, 16), error: ioError() } },
      diff: fixture("golden/pr.diff"),
      compare: fixture("golden/pr.diff"),
    });
    expect(brokenAction.failed).toHaveLength(1);
    expect(brokenAction.failed[0]?.startsWith("pharn-ci:")).toBe(true);
    expect(brokenAction.failed[0]).toContain("EIO");
    expect(brokenAction.outputs["report-path"]).toBeUndefined();

    const directoryAction = await runAction(inputs, {
      files: { [COVERAGE]: dirError(dirPath) },
      streams: { [COVERAGE]: { chunks: [], error: dirError(dirPath) } },
      diff: fixture("golden/pr.diff"),
      compare: fixture("golden/pr.diff"),
    });
    expect(directoryAction.failed).toHaveLength(1);
    expect(directoryAction.failed[0]?.startsWith("pharn-ci:")).toBe(true);
    expect(directoryAction.failed[0]).toContain("EISDIR");
    expect(directoryAction.outputs["report-path"]).toBeUndefined();
  });
});
