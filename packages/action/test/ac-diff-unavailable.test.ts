import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// run() is loaded inside each test body, like the other AC tests: they are written before the build.
// The Action runs against in-memory deps for a pull_request event with no local git history (every git call but
// ls-files throws) and a GitHub compare API that refuses the diff, so the diff is unavailable.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

// What the runner passes when an input is not set: the action.yml default, else "".
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "false",
  "fail-on-threshold": "true",
  config: ".pharn/ci.yml",
};

function fakeAction(inputs: Record<string, string>) {
  const failed: string[] = [];
  const outputs: Record<string, string> = {};
  const files = new Map([[resolve(WORKSPACE, "coverage/lcov.info"), fixture("golden/coverage.info")]]);
  const deps = {
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
    workspace: WORKSPACE,
    tempDir: "/home/runner/work/_temp",
    api: {
      compareDiff: async () => {
        throw new Error("Sorry, the diff exceeded the maximum number of files (300)");
      },
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async () => {},
      updateComment: async () => {},
    },
    git: async (args: string[]) => {
      if (args.includes("ls-files")) {
        const paths = fixture("golden/files.txt").trim().split("\n");
        return args.includes("-z") ? `${paths.join("\0")}\0` : `${paths.join("\n")}\n`;
      }
      throw new Error("fatal: bad object");
    },
    readFile: async (path: string) => files.get(path) ?? null,
    writeFile: async () => {},
    resolvePath: (...segments: string[]) => resolve(...segments),
    info: () => {},
    warning: () => {},
    setOutput: (name: string, value: unknown) => {
      outputs[name] = String(value);
    },
    setFailed: (message: string) => {
      failed.push(message);
    },
    writeSummary: async () => {},
  };
  return { deps, failed, outputs };
}

async function runAction(inputs: Record<string, string>) {
  const { run } = await import("../src/run.js");
  const action = fakeAction(inputs);
  await run(action.deps as never);
  return action;
}

describe("action: an unavailable diff", () => {
  it("AC-3: fails the step with a threshold and only warns without one", async () => {
    const gated = await runAction({ "coverage-file": "coverage/lcov.info", threshold: "80" });
    expect(gated.outputs.verdict).toBe("fail");
    expect(gated.failed).toHaveLength(1);
    expect(gated.failed[0]).toContain("Diff coverage was not computed");

    const ungated = await runAction({ "coverage-file": "coverage/lcov.info" });
    expect(ungated.outputs.verdict).toBe("warn");
    expect(ungated.failed).toEqual([]);
  });
});
