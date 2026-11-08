import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// Stale instructions (Horizon 2 item H3) in the CLI: `pharn-ci check` with its real Node deps on a temporary repository
// whose feature branch edits CLAUDE.md. Without a policy the instruction files are read and the stale tokens reported;
// a failing instruction read writes one stderr line and reports nothing.

interface Deps {
  gitBatch?(args: string[], input: string): Promise<Uint8Array>;
  stdout(text: string): void;
  stderr(text: string): void;
}
type Message = { level: string; code: string; text: string };
type Report = Record<string, unknown> & {
  verdict: string;
  messages: Message[];
  setupHealth?: { stale: { id: string; path: string; line: number; kind: string; token?: string }[] };
};

const LOG_PREFIX =
  "pharn-ci: could not read the agent instruction files from git, so stale instructions are not checked: ";
let dir: string;

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-stale-cli-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "x", scripts: { build: "tsc" } })}\n`);
  writeFileSync(join(dir, "CLAUDE.md"), "# Claude\n\nBuild with `pnpm build`.\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, "src/math.ts"), "export const a = 2;\n");
  writeFileSync(
    join(dir, "CLAUDE.md"),
    "# Claude\n\nBuild with `pnpm build`, lint with `pnpm run lint`.\nThe code is in `src/math.ts` and `src/gone.ts`.\n",
  );
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  mkdirSync(join(dir, "coverage"));
  writeFileSync(join(dir, "coverage/lcov.info"), `SF:${dir}/src/math.ts\nDA:1,1\nend_of_record\n`);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function runCli(failInstructions = false) {
  const { main } = await import("../src/main.js");
  const { nodeDeps } = await import("../src/nodeDeps.js");
  const deps = nodeDeps(dir) as unknown as Deps;
  const realBatch = deps.gitBatch as NonNullable<Deps["gitBatch"]>;
  deps.gitBatch = (args, input) =>
    failInstructions && input.includes("HEAD:CLAUDE.md")
      ? Promise.reject(new Error("fatal: simulated failure"))
      : realBatch(args, input);
  let out = "";
  let err = "";
  deps.stdout = (text) => {
    out += text;
  };
  deps.stderr = (text) => {
    err += text;
  };
  const code = await main(
    ["check", "--base", "main", "--coverage", "coverage/lcov.info", "--format", "json"],
    deps as never,
  );
  const report = JSON.parse(out) as Report;
  expectValidReport(report);
  return { code, report, err };
}

describe("pharn-ci check: stale instructions", { timeout: 120_000 }, () => {
  it("reports the stale script and path of the edited CLAUDE.md without a policy, as warnings that exit 0", async () => {
    const { code, report, err } = await runCli();
    expect(code).toBe(0);
    expect(report.setupHealth?.stale).toEqual([
      { id: "SI01", path: "CLAUDE.md", line: 3, kind: "command", token: "pnpm run lint" },
      { id: "SI02", path: "CLAUDE.md", line: 4, kind: "path", token: "src/gone.ts" },
    ]);
    expect(report.messages.filter((m) => m.code.startsWith("SETUP_STALE_")).map((m) => m.code)).toEqual([
      "SETUP_STALE_SI01",
      "SETUP_STALE_SI02",
    ]);
    expect(report.verdict).toBe("warn");
    expect(err).not.toContain(LOG_PREFIX);
  });

  it("a failing instruction read writes one stderr line and reports no stale instruction", async () => {
    const { report, err } = await runCli(true);
    expect(report.setupHealth).toBeUndefined();
    expect(err.split("\n").filter((line) => line.startsWith(LOG_PREFIX))).toHaveLength(1);
  });
});
