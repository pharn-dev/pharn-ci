import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { harness, PR_CONTEXT } from "./harness.js";

// check() is observed, not replaced: the mock calls the real check() and records the input the Action built, which
// nothing the Action writes shows. run() and createNodeIo() are loaded inside each test body: these tests are written
// before the Action gathers test sources, so nothing that depends on that may run while the file loads.
vi.mock("@pharn-ci/core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, check: vi.fn(actual.check as (input: unknown) => unknown) };
});

const ROOT = new URL("../../../", import.meta.url);
const readRoot = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const fixture = (path: string) => readRoot(`fixtures/${path}`);

function v2Validator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  ajv.addSchema(JSON.parse(readRoot("schema/report.v1.json")));
  return ajv.compile(JSON.parse(readRoot("schema/report.v2.json")));
}
const validate = v2Validator();
function expectValid(report: unknown, label: string) {
  expect(validate(report), `${label}: ${JSON.stringify(validate.errors)}`).toBe(true);
}

type SourceFile = { path: string; text: string };
type Side = { unavailable?: string; files?: SourceFile[]; dropped?: unknown[] };
type Input = Record<string, unknown> & { testSources?: { base: Side; head: Side } };
type Run = (deps: never) => Promise<unknown>;

const MAIN_TEXT = 'import { it } from "vitest";\nit("adds", () => {});\n';
const FEATURE_TEXT = 'import { expect, it } from "vitest";\nit("adds", () => expect(1 + 1).toBe(2));\n';

let dir: string;
let mainId: string;
let headId: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-test-sources-action-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "tests"));
  writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 2;\n");
  writeFileSync(join(dir, "tests/a.test.ts"), MAIN_TEXT);
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  mainId = sh("rev-parse", "HEAD").trim();
  sh("checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 3;\nexport const c = 4;\n");
  writeFileSync(join(dir, "tests/a.test.ts"), FEATURE_TEXT);
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  headId = sh("rev-parse", "HEAD").trim();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function load() {
  const { run } = (await import("../src/run.js")) as unknown as { run: Run };
  const { createNodeIo } = await import("../src/node-io.js");
  const core = await import("@pharn-ci/core");
  return { run, createNodeIo, spy: vi.mocked(core.check) };
}

/** The input of the last check() call. */
function lastInput(spy: { mock: { calls: unknown[][] } }): Input {
  expect(spy.mock.calls.length, "check() was called").toBeGreaterThan(0);
  return spy.mock.calls.at(-1)?.[0] as Input;
}

const recorder = (calls: string[][]) => ({
  wrap<A extends unknown[], R>(fn: (args: string[], ...rest: A) => R) {
    return (args: string[], ...rest: A): R => {
      calls.push([...args]);
      return fn(args, ...rest);
    };
  },
});

const gathersNothing = (calls: string[][]) =>
  calls.filter((args) => args[0] === "merge-base" || args[0] === "cat-file");

describe("action: test sources", () => {
  it("AC-14: a local-git diff passes sources with base and head text, and test-integrity off gathers nothing", async () => {
    const { run, createNodeIo, spy } = await load();

    async function localRun(inputs: Record<string, string>) {
      const lcov = `SF:${dir}/src/math.ts\nDA:1,1\nDA:2,1\nDA:3,0\nend_of_record\n`;
      const h = harness({
        inputs,
        files: { [`${dir}/coverage/lcov.info`]: lcov },
        context: {
          ...PR_CONTEXT,
          payload: { pull_request: { number: 7, base: { sha: mainId }, head: { sha: headId } } },
        },
      });
      const io = createNodeIo(dir) as unknown as Record<string, (...args: never[]) => unknown>;
      const calls: string[][] = [];
      const rec = recorder(calls);
      const deps = h.deps as unknown as Record<string, unknown>;
      deps.workspace = dir;
      deps.git = rec.wrap(io.git as (args: string[]) => Promise<string>);
      deps.gitStream = rec.wrap(io.gitStream as (args: string[]) => AsyncIterable<string>);
      if (io.gitBatch) deps.gitBatch = rec.wrap(io.gitBatch as (args: string[], input: string) => Promise<Uint8Array>);
      deps.listDir = io.listDir;
      spy.mockClear();
      await run(h.deps as never);
      const report = JSON.parse(h.written[h.outputs["report-path"] as string] as string);
      return { h, calls, input: lastInput(spy), report };
    }

    const local = await localRun({});
    expect(local.h.failed).toEqual([]);
    expect(local.input.testSources?.base.files).toEqual([{ path: "tests/a.test.ts", text: MAIN_TEXT }]);
    expect(local.input.testSources?.head.files).toEqual([{ path: "tests/a.test.ts", text: FEATURE_TEXT }]);
    expectValid(local.report, "local git");

    const off = await localRun({ "test-integrity": "off" });
    expect(gathersNothing(off.calls)).toEqual([]);
    expect(Object.hasOwn(off.input, "testSources")).toBe(false);
    expectValid(off.report, "local git, test-integrity off");
  }, 30_000);

  it("AC-14: compare-API and pr-number runs pass unavailable sources and make no new GitHub API call", async () => {
    const { run, spy } = await load();
    const unavailable = { unavailable: expect.stringMatching(/\S/) };

    // The local base is missing, so the diff comes from the compare API.
    async function compareRun(inputs: Record<string, string>) {
      const h = harness({ localGit: false, inputs });
      const batchCalls: string[][] = [];
      (h.deps as unknown as Record<string, unknown>).gitBatch = async (args: string[]) => {
        batchCalls.push([...args]);
        return new Uint8Array();
      };
      spy.mockClear();
      await run(h.deps as never);
      const report = JSON.parse(h.written[h.outputs["report-path"] as string] as string);
      return { h, input: lastInput(spy), report, batchCalls };
    }

    const compare = await compareRun({});
    const compareOff = await compareRun({ "test-integrity": "off" });
    expect(compare.h.apiCalls.some((call) => call.startsWith("compare "))).toBe(true);
    expect(compare.input.testSources).toEqual({ base: unavailable, head: unavailable });
    expect(compare.h.apiCalls).toEqual(compareOff.h.apiCalls);
    expectValid(compare.report, "compare API");
    expectValid(compareOff.report, "compare API, test-integrity off");

    const prNumber = await prNumberRun(run, {});
    const prNumberOff = await prNumberRun(run, { "test-integrity": "off" });
    expect(prNumber.failed).toEqual([]);
    expect(prNumber.input, "check() was called in pr-number mode").toBeDefined();
    expect(prNumber.input?.testSources).toEqual({ base: unavailable, head: unavailable });
    expect(prNumber.apiCalls).toEqual(prNumberOff.apiCalls);
    expectValid(prNumber.report, "pr-number mode");
    expectValid(prNumberOff.report, "pr-number mode, test-integrity off");
  }, 30_000);
});

// PR-number mode, with deps built as packages/action/test/ac-pr-number-mode.test.ts builds them: no pull_request
// payload, the pr-number input names PR 42, and the GitHub API serves its base, head, tree and compare diff.
const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const DEFAULT_BRANCH_TIP = "4444444444444444444444444444444444444444";
const TREE_PATHS = ["README.md", "src/math.ts", "src/new.ts", "src/utils/new-name.ts", "packages/api/AGENTS.md"];
const LOCAL_PATHS = ["README.md", "src/math.ts", ".cursor/rules/style.mdc"];
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "true",
  "fail-on-threshold": "true",
  config: "",
  "github-token": "test-token",
};

async function prNumberRun(run: Run, extraInputs: Record<string, string>) {
  const { check } = await import("@pharn-ci/core");
  const spy = vi.mocked(check);
  const inputs: Record<string, string> = {
    "coverage-file": "coverage/lcov.info",
    "pr-number": "42",
    "head-sha": HEAD_SHA,
    ...extraInputs,
  };
  const failed: string[] = [];
  const apiCalls: string[] = [];
  const written = new Map<string, string>();
  const files = new Map([[resolve(WORKSPACE, "coverage/lcov.info"), fixture("golden/coverage.info")]]);
  const deps = {
    getInput: (name: string) => inputs[name] ?? INPUT_DEFAULTS[name] ?? "",
    context: {
      eventName: "workflow_run",
      sha: DEFAULT_BRANCH_TIP,
      ref: "refs/heads/main",
      repo: { owner: "octo", repo: "demo" },
      issue: { owner: "octo", repo: "demo" },
      payload: { workflow_run: { id: 99, event: "pull_request", head_sha: HEAD_SHA } },
    },
    workspace: WORKSPACE,
    tempDir: "/home/runner/work/_temp",
    api: {
      getPullRequest: async (pullNumber: number) => {
        apiCalls.push(`getPullRequest ${pullNumber}`);
        if (pullNumber === 42) return { baseSha: BASE_SHA, headSha: HEAD_SHA };
        throw new Error("Not Found");
      },
      listTree: async (sha: string) => {
        apiCalls.push(`listTree ${sha}`);
        return { paths: TREE_PATHS, truncated: false };
      },
      compareDiff: async (basehead: string) => {
        apiCalls.push(`compare ${basehead}`);
        return fixture("golden/pr.diff");
      },
      viewerLogin: async () => {
        apiCalls.push("viewerLogin");
        return "github-actions[bot]";
      },
      listComments: async (n: number) => {
        apiCalls.push(`list ${n}`);
        return [];
      },
      createComment: async (n: number) => {
        apiCalls.push(`create ${n}`);
      },
      updateComment: async (id: number) => {
        apiCalls.push(`update ${id}`);
      },
    },
    git: async (args: string[]) => {
      if (args.includes("ls-files")) {
        return args.includes("-z") ? `${LOCAL_PATHS.join("\0")}\0` : `${LOCAL_PATHS.join("\n")}\n`;
      }
      if (args[0] === "rev-parse" && args.includes("HEAD")) return `${DEFAULT_BRANCH_TIP}\n`;
      if (args[0] === "rev-parse") return "ok\n";
      if (args.includes("diff")) return fixture("golden/pr.diff");
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
    gitBatch: async () => new Uint8Array(),
    readFile: async (path: string) => files.get(path) ?? null,
    writeFile: async (path: string, text: string) => {
      written.set(path, text);
    },
    resolvePath: (...segments: string[]) => resolve(...segments),
    info: () => {},
    warning: () => {},
    setOutput: () => {},
    setFailed: (message: string) => {
      failed.push(message);
    },
    writeSummary: async () => {},
  };
  spy.mockClear();
  await run(deps as never);
  const recorded = spy.mock.calls.at(-1)?.[0] as Input | undefined;
  const reportText = [...written.entries()].find(([path]) => path.endsWith("report.json"))?.[1];
  return {
    failed,
    apiCalls,
    report: reportText === undefined ? undefined : JSON.parse(reportText),
    /** The input of this run's last check() call, captured before the next run clears the spy. */
    input: recorded,
  };
}
