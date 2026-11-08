import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION } from "../../core/src/version.js";
import { expectValidReport } from "../../core/test/schema.js";

// fix-hints (H6), AC-11. run(), main() and the core's fix table are loaded inside the test body: the AC test is written
// before the build adds the `fix` objects and regenerates fixtures/golden/report.json. The Action and the CLI run
// against in-memory deps: a fake repo rooted at REPO_ROOT whose git streams the golden diff and lists the golden files.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const REPO_ROOT = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const COVERAGE = "coverage/lcov.info";

type Fix = { kind: string; target?: string; hint: string };
type Report = { tool: { name: string; version: string }; messages: { code: string; fix?: Fix }[] };

/** fixtures/golden/report.json as this build reports it: the CLI and the Action report the package VERSION. */
const goldenReport = () => {
  const golden = JSON.parse(fixture("golden/report.json")) as Report;
  return { ...golden, tool: { ...golden.tool, version: VERSION } };
};

function cut(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let at = 0; at < text.length; at += size) chunks.push(text.slice(at, at + size));
  return chunks;
}

async function* chunks(list: readonly string[]): AsyncGenerator<string> {
  for (const chunk of list) yield chunk;
}

/** Deps shared by the CLI and the Action: the golden repo, its lcov streamed, its diff streamed. */
function commonDeps() {
  const tracked = fixture("golden/files.txt").trim().split("\n");
  const coverage = fixture("golden/coverage.info");
  const streamCalls: string[][] = [];
  const deps: Record<string, unknown> = {
    git: async (args: string[]) => {
      if (args[0] === "ls-files") return `${tracked.join("\0")}\0`;
      if (args[0] === "ls-tree") return "";
      if (args[0] === "diff") throw new Error("the whole-text git call was used for the diff");
      if (args[0] === "rev-parse" && args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return `${HEAD_SHA}\n`;
      return `${BASE_SHA}\n`;
    },
    gitStream: (args: string[]) => {
      streamCalls.push(args);
      if (args[0] !== "diff") throw new Error(`unexpected streamed git ${args.join(" ")}`);
      return chunks(cut(fixture("golden/pr.diff"), 9));
    },
    readFile: async (path: string) => (path === resolve(REPO_ROOT, COVERAGE) ? coverage : null),
    readFileStream: async (path: string) => (path === resolve(REPO_ROOT, COVERAGE) ? chunks(cut(coverage, 64)) : null),
    resolvePath: (...segments: string[]) => resolve(...segments),
  };
  return { deps, streamCalls };
}

async function runAction(): Promise<{ report: Report; compareCalls: string[]; streamCalls: string[][] }> {
  const { run } = await import("../src/run.js");
  const outputs: Record<string, string> = {};
  const written = new Map<string, string>();
  const compareCalls: string[] = [];
  const inputs: Record<string, string> = { "coverage-file": COVERAGE, threshold: "80", comment: "false" };
  const { deps, streamCalls } = commonDeps();
  Object.assign(deps, {
    getInput: (name: string) => inputs[name] ?? "",
    context: {
      eventName: "pull_request",
      sha: HEAD_SHA,
      ref: "refs/pull/7/merge",
      repo: { owner: "octo", repo: "demo" },
      issue: { owner: "octo", repo: "demo", number: 7 },
      payload: {
        pull_request: { number: 7, base: { sha: BASE_SHA, ref: "main" }, head: { sha: HEAD_SHA, ref: "feature" } },
      },
    },
    workspace: REPO_ROOT,
    tempDir: "/home/runner/work/_temp",
    api: {
      compareDiff: async (basehead: string) => {
        compareCalls.push(basehead);
        throw new Error("the compare API was called");
      },
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async () => {},
      updateComment: async () => {},
    },
    writeFile: async (path: string, text: string) => {
      written.set(path, text);
    },
    info: () => {},
    warning: () => {},
    setOutput: (name: string, value: unknown) => {
      outputs[name] = String(value);
    },
    setFailed: () => {},
    writeSummary: async () => {},
  });
  await run(deps as never);
  const text = written.get(outputs["report-path"] ?? "");
  if (text === undefined) throw new Error(`no report written at report-path ${outputs["report-path"]}`);
  return { report: JSON.parse(text) as Report, compareCalls, streamCalls };
}

async function runCli(): Promise<{ code: number; report: Report; streamCalls: string[][] }> {
  const { main } = await import("../../cli/src/main.js");
  const out: string[] = [];
  const { deps, streamCalls } = commonDeps();
  Object.assign(deps, {
    cwd: REPO_ROOT,
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: () => {},
  });
  const code = await main(["check", "--coverage", COVERAGE, "--threshold", "80", "--format", "json"], deps as never);
  return { code, report: JSON.parse(out.join("")) as Report, streamCalls };
}

describe("the Action and the CLI write fix hints", { timeout: 120_000 }, () => {
  it("AC-11: the Action on a streamed local diff and lcov, and the CLI on the same inputs, both equal the regenerated golden report, carry fix on every message, and make no compare API call", async () => {
    const action = await runAction();
    expectValidReport(action.report);
    expect(action.compareCalls).toEqual([]);
    expect(action.streamCalls.length, "the Action streamed its local diff").toBeGreaterThan(0);
    expect(action.report).toEqual(goldenReport());

    const cli = await runCli();
    expectValidReport(cli.report);
    expect(cli.code).toBe(1);
    expect(cli.streamCalls.length, "the CLI streamed its diff").toBeGreaterThan(0);
    expect(cli.report).toEqual(goldenReport());

    const core = (await import("@pharn-ci/core")) as unknown as {
      MESSAGE_FIXES?: Record<string, { kind: string; hint: string }>;
    };
    expect(core.MESSAGE_FIXES, "MESSAGE_FIXES is exported").toBeDefined();
    for (const [who, report] of [
      ["Action", action.report],
      ["CLI", cli.report],
    ] as const) {
      expect(report.messages.length, `${who}: messages`).toBeGreaterThan(0);
      for (const message of report.messages) {
        expect(message.fix, `${who} ${message.code} carries fix`).toBeDefined();
        expect(message.fix?.kind, `${who} ${message.code} kind`).toBe(core.MESSAGE_FIXES?.[message.code]?.kind);
        expect(message.fix?.hint, `${who} ${message.code} hint`).toBe(core.MESSAGE_FIXES?.[message.code]?.hint);
        expect(message.fix, `${who} ${message.code}: no target`).not.toHaveProperty("target");
      }
    }
  });
});
