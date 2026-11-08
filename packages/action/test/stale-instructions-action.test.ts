import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { runGitBatch } from "../../node-io/src/io.js";
import { harness, PR_CONTEXT } from "./harness.js";

// Stale instructions (Horizon 2 item H3) in the Action. The in-memory harness gives the golden diff (fixtures/golden/
// pr.diff), which deletes src/legacy.ts and renames src/old-name.ts to src/utils/new-name.ts; a real temporary
// repository commits AGENTS.md, which names both old paths and is not touched by the change. The removal alone makes
// them findings (SI02 and SI03). PR-number mode, a compare-API diff and a run without a batch git runner read nothing.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const GOLDEN_ROOT = "/home/runner/work/demo/demo";
const AGENTS = "# Agents\n\nThe old helpers are in `src/legacy.ts`; read [the old module](src/old-name.ts).\n";
const TRACKED = ["AGENTS.md", "README.md", "src/math.ts", "src/new.ts", "src/utils/new-name.ts"];
const LOG_PREFIX =
  "pharn-ci: could not read the agent instruction files from git, so stale instructions are not checked: ";

type Message = { level: string; code: string; text: string };
type Report = {
  verdict: string;
  messages: Message[];
  setupHealth?: { stale: { id: string; path: string; line: number; kind: string; token?: string }[] };
};

let dir: string;

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-stale-action-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "AGENTS.md"), AGENTS);
  sh("add", "-A");
  sh("commit", "-q", "-m", "agent setup");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function actionRun(options: { localGit?: boolean; batch?: boolean; failInstructions?: boolean } = {}) {
  const { run } = await import("../src/run.js");
  const h = harness({
    context: PR_CONTEXT as never,
    inputs: { "coverage-file": "coverage/lcov.info", policy: "never" },
    files: { [`${GOLDEN_ROOT}/coverage/lcov.info`]: read("fixtures/golden/coverage.info") },
    lsFiles: TRACKED,
    localGit: options.localGit ?? true,
  });
  const batchCalls: string[] = [];
  if (options.batch !== false) {
    Object.assign(h.deps, {
      gitBatch: async (args: string[], input: string) => {
        batchCalls.push(input);
        if (options.failInstructions && input.includes("HEAD:AGENTS.md")) throw new Error("fatal: simulated failure");
        return runGitBatch(dir, args, input);
      },
    });
  }
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, report, batchCalls };
}

describe("action: stale instructions", { timeout: 120_000 }, () => {
  it("a local-diff run reads AGENTS.md and reports the paths the change removed, though AGENTS.md is untouched", async () => {
    const { report, batchCalls, h } = await actionRun();
    expect(batchCalls.filter((input) => input.includes("HEAD:AGENTS.md"))).toHaveLength(1);
    expect(report.setupHealth?.stale).toEqual([
      { id: "SI02", path: "AGENTS.md", line: 3, kind: "path", token: "src/legacy.ts" },
      { id: "SI03", path: "AGENTS.md", line: 3, kind: "file", token: "src/old-name.ts" },
    ]);
    const codes = report.messages.filter((m) => m.code.startsWith("SETUP_STALE_")).map((m) => `${m.level} ${m.code}`);
    expect(codes).toEqual(["warn SETUP_STALE_SI02", "warn SETUP_STALE_SI03"]);
    // The instruction text never reaches a log line, the summary or a message.
    const logs = [...h.infos, ...h.warnings].join("\n");
    expect(logs).not.toContain("old helpers");
    expect(h.summary.join("\n")).not.toContain("old helpers");
    expect(h.summary.join("\n")).toContain("### 📄 Instructions");
    for (const m of report.messages) expect(m.text).not.toContain("old helpers");
  });

  it("a compare-API diff and a run without a batch git runner read nothing and report nothing", async () => {
    const compare = await actionRun({ localGit: false });
    expect(compare.batchCalls).toEqual([]);
    expect(compare.report.setupHealth).toBeUndefined();
    const noBatch = await actionRun({ batch: false });
    expect(noBatch.report.setupHealth).toBeUndefined();
  });

  it("a failing instruction read logs one line and reports nothing", async () => {
    const { report, h } = await actionRun({ failInstructions: true });
    expect(report.setupHealth).toBeUndefined();
    expect([...h.infos, ...h.warnings].filter((line) => line.startsWith(LOG_PREFIX))).toHaveLength(1);
  });
});
