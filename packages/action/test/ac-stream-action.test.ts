import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// run() is loaded inside each test body: the AC tests are written before the Action streams its local diff and
// coverage files, so nothing that depends on that may run while the file loads. The Action runs against in-memory
// deps for a pull_request event.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const COVERAGE = "coverage/lcov.info";

// What the runner passes when an input is not set: the action.yml default, else "".
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "false",
  "fail-on-threshold": "true",
  config: "",
};

/** Cuts `text` into chunks of `size` characters (the last one may be shorter). */
function cut(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let at = 0; at < text.length; at += size) chunks.push(text.slice(at, at + size));
  return chunks;
}

interface Setup {
  inputs: Record<string, string>;
  /** Whole-file reads (path relative to WORKSPACE -> text); a path in `rejectRead` rejects instead. */
  files?: Record<string, string>;
  rejectRead?: string[];
  /** Streamed reads: path relative to WORKSPACE -> chunks. */
  streams: Record<string, readonly string[]>;
  /** The streamed local diff: its chunks, then an optional error thrown after them. */
  diffStream: { chunks: readonly string[]; error?: Error };
  /** The compare API's diff, or an error it throws. */
  compare: string | Error;
}

async function runAction(setup: Setup) {
  const { run } = await import("../src/run.js");
  const failed: string[] = [];
  const infos: string[] = [];
  const outputs: Record<string, string> = {};
  const written = new Map<string, string>();
  const compareCalls: string[] = [];
  const streamCalls: string[][] = [];
  const at = (path: string) => resolve(WORKSPACE, path);
  const files = new Map(Object.entries(setup.files ?? {}).map(([path, text]) => [at(path), text]));
  const rejected = new Set((setup.rejectRead ?? []).map(at));
  const streams = new Map(Object.entries(setup.streams).map(([path, chunks]) => [at(path), chunks]));
  const tracked = fixture("golden/files.txt").trim().split("\n");

  const deps = {
    getInput: (name: string) => setup.inputs[name] ?? INPUT_DEFAULTS[name] ?? "",
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
    workspace: WORKSPACE,
    tempDir: "/home/runner/work/_temp",
    api: {
      compareDiff: async (basehead: string) => {
        compareCalls.push(basehead);
        if (setup.compare instanceof Error) throw setup.compare;
        return setup.compare;
      },
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async () => {},
      updateComment: async () => {},
    },
    git: async (args: string[]) => {
      if (args[0] === "ls-files") return `${tracked.join("\0")}\0`;
      if (args[0] === "ls-tree") return "";
      if (args[0] === "diff") throw new Error("the whole-text git call was used for the diff");
      if (args[0] === "rev-parse" && args[1] === "HEAD") return `${HEAD_SHA}\n`;
      return `${BASE_SHA}\n`;
    },
    gitStream: (args: string[]) => {
      streamCalls.push(args);
      if (args[0] !== "diff") throw new Error(`unexpected streamed git ${args.join(" ")}`);
      const { chunks, error } = setup.diffStream;
      return (async function* () {
        for (const chunk of chunks) yield chunk;
        if (error) throw error;
      })();
    },
    readFile: async (path: string) => {
      if (rejected.has(path)) throw new Error(`the whole-file read was used for ${path}`);
      return files.get(path) ?? null;
    },
    readFileStream: async (path: string) => {
      const chunks = streams.get(path);
      if (chunks === undefined) return null;
      return (async function* () {
        for (const chunk of chunks) yield chunk;
      })();
    },
    writeFile: async (path: string, text: string) => {
      written.set(path, text);
    },
    resolvePath: (...segments: string[]) => resolve(...segments),
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
  };

  await run(deps as never);
  return {
    failed,
    infos,
    outputs,
    compareCalls,
    streamCalls,
    report: () => {
      const text = written.get(outputs["report-path"] ?? "");
      if (text === undefined) throw new Error(`no report written at report-path ${outputs["report-path"]}`);
      return JSON.parse(text);
    },
  };
}

describe("action: streamed inputs", () => {
  it("AC-8: a streamed local diff and lcov file give the golden report without calling the compare API", async () => {
    // The golden diff with CRLF endings, cut so that one chunk ends with a CR and the next starts with its LF.
    const crlfDiff = fixture("golden/pr.diff").replace(/\n/g, "\r\n");
    const firstCr = crlfDiff.indexOf("\r");
    const diffChunks = [crlfDiff.slice(0, firstCr + 1), ...cut(crlfDiff.slice(firstCr + 1), 5)];
    expect(diffChunks[0]?.endsWith("\r")).toBe(true);
    expect(diffChunks[1]?.startsWith("\n")).toBe(true);

    const action = await runAction({
      inputs: { "coverage-file": COVERAGE, threshold: "80" },
      rejectRead: [COVERAGE],
      streams: { [COVERAGE]: cut(fixture("golden/coverage.info"), 7) },
      diffStream: { chunks: diffChunks },
      compare: new Error("the compare API must not be called"),
    });

    const failedOther = action.failed.filter((message) => !message.includes("below the threshold"));
    expect(failedOther).toEqual([]);
    expect(action.report()).toEqual(JSON.parse(fixture("golden/report.json")));
    expect(action.compareCalls).toEqual([]);
    expect(action.streamCalls.filter((args) => args[0] === "diff")).toHaveLength(1);
    expect(action.infos.filter((line) => line.startsWith("coverage: "))).toEqual(["coverage: lcov (auto-detected)"]);
  });

  it("AC-12: a failed streamed local diff and a failed compare API give DIFF_UNAVAILABLE and fail the step", async () => {
    const action = await runAction({
      inputs: { "coverage-file": COVERAGE, threshold: "80" },
      files: { [COVERAGE]: fixture("golden/coverage.info") },
      streams: { [COVERAGE]: cut(fixture("golden/coverage.info"), 7) },
      diffStream: { chunks: [], error: new Error("fatal: bad object 1111111111111111111111111111111111111111") },
      compare: new Error("Sorry, the diff exceeded the maximum number of files (300)"),
    });

    // The local diff was attempted through the stream, and the compare API was tried after it failed.
    expect(action.streamCalls.filter((args) => args[0] === "diff")).toHaveLength(1);
    expect(action.compareCalls).toHaveLength(1);

    const report = action.report();
    expectValidReport(report);
    expect(report.diffCoverage).toBeNull();
    expect(report.verdict).toBe("fail");
    const unavailable = report.messages.filter((message: { code: string }) => message.code === "DIFF_UNAVAILABLE");
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0].level).toBe("error");

    expect(action.failed).toHaveLength(1);
    expect(action.failed[0]).toContain(unavailable[0].text);
  });
});
