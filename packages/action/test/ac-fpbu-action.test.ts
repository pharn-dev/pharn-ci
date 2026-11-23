import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Report } from "@pharn-ci/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// CORE-348 (file-policy-base-union), AC-15. run() and the Node git runners are loaded inside the test body: the AC test
// is written before the Action reads the `file:` policy's base copy ahead of applyPolicy, so nothing the build adds may
// run while this file loads. A real temporary git repository: the base commit's policy sets coverage.threshold 90; the
// pull request lowers it to 10 and changes two lines of src/math.ts, one of them covered (50%).

const POLICY_PATH = ".pharn/policy.json";
const policy = (threshold: number) => `${JSON.stringify({ version: 1, coverage: { threshold } }, null, 2)}\n`;

let dir: string;
/** Line 1 of src/math.ts covered, line 2 not: the change is 50% covered. */
const LCOV = () => `SF:${dir}/src/math.ts\nDA:1,1\nDA:2,0\nend_of_record\n`;
let mainId: string;
let headId: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-fpbu-action-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const put = (path: string, text: string) => {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  put("AGENTS.md", "# Agents\n");
  put(POLICY_PATH, policy(90));
  put("src/math.ts", "export const a = 1;\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  mainId = sh("rev-parse", "HEAD").trim();
  sh("checkout", "-q", "-b", "feature");
  put(POLICY_PATH, policy(10));
  put("src/math.ts", "export const a = 2;\nexport const b = 3;\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  headId = sh("rev-parse", "HEAD").trim();
  // The coverage report is written by the test run, never committed.
  put("coverage/lcov.info", LCOV());
}, 60_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function realReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

describe("action: a file: policy's pull request cannot lower the threshold its base copy sets", () => {
  it("AC-15: base threshold 90, pull request 10, change at 50%: the report's threshold is 90 and the coverage gate fails", async () => {
    const { run } = await import("../src/run.js");
    const { createNodeIo } = await import("../src/node-io.js");
    const h = harness({
      inputs: { policy: `file:${POLICY_PATH}`, upload: "never", comment: "false" },
      files: { [`${dir}/coverage/lcov.info`]: LCOV() },
      context: {
        ...PR_CONTEXT,
        payload: {
          pull_request: {
            number: 7,
            base: { sha: mainId },
            head: { sha: headId },
            user: { login: "octocat", type: "User" },
            labels: [],
            commits: 1,
          },
        },
      },
    });
    const io = createNodeIo(dir);
    Object.assign(h.deps, {
      workspace: dir,
      readFile: realReadFile,
      git: io.git,
      gitStream: io.gitStream,
      gitBatch: io.gitBatch,
      listDir: io.listDir,
    });
    h.deps.api = {
      ...h.deps.api,
      async listPullRequestCommits(_pullNumber: number, page: number) {
        const commits = [{ commit: { message: "Lower\n" }, author: { login: "octocat" }, committer: null }];
        return { commits: page === 1 ? commits : [], hasNext: false };
      },
    } as typeof h.deps.api;

    await run(h.deps);
    const text = h.written[h.outputs["report-path"] ?? ""];
    if (text === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(h.failed)}`);
    const report = JSON.parse(text) as Report;
    expectValidReport(report);

    expect(report.diffCoverage?.percent, "control: the change is 50% covered").toBe(50);
    expect(report.diffCoverage?.threshold).toBe(90);
    const below = report.messages.filter((m) => m.code === "DIFF_COVERAGE_BELOW_THRESHOLD");
    expect(below.map((m) => m.level)).toEqual(["error"]);
    expect(report.verdict).toBe("fail");
  }, 60_000);
});
