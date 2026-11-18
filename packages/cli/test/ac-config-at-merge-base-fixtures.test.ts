import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { listDir, readFile, runGit, runGitBatch } from "../../node-io/src/index.js";

// CORE-95, the fixture cases, each in a real temporary git repository (the base commit on `main`, the pull request's
// commit on `feature`) through the Action's run() and the CLI's main() with --base, with real git and the real
// merge-base reader. run() and main() are loaded inside each test body. Inputs: fixtures/config-at-merge-base/.

const FIXTURES = new URL("../../../fixtures/config-at-merge-base/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");
const CONFIG = ".pharn/ci.yml";

type Message = { level: string; code: string; text: string };
type Report = {
  verdict: string;
  messages: Message[];
  diffCoverage: { percent: number | null; threshold: number | null } | null;
};

/** A file of the tree: its text, a symbolic link, or null to delete it. */
type Entry = string | { symlink: string } | null;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function put(dir: string, path: string, entry: Entry): void {
  const full = join(dir, path);
  if (entry === null) {
    unlinkSync(full);
    return;
  }
  mkdirSync(dirname(full), { recursive: true });
  try {
    unlinkSync(full);
  } catch {
    // not there yet
  }
  if (typeof entry === "string") writeFileSync(full, entry);
  else symlinkSync(entry.symlink, full);
}

/** A repository whose `main` holds the base files plus the two empty sources, and whose `feature` adds the change. */
function repository(base: Record<string, Entry>, change: Record<string, Entry>) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-core95-")));
  dirs.push(dir);
  const sh = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  for (const [path, entry] of Object.entries({ "src/a.ts": "", "src/b.ts": "", ...base })) put(dir, path, entry);
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  const baseSha = sh("rev-parse", "HEAD").trim();
  sh("checkout", "-q", "-b", "feature");
  const sources = { "src/a.ts": "export const a1 = 1;\nexport const a2 = 2;\n" };
  for (const [path, entry] of Object.entries({
    ...sources,
    "src/b.ts": "export const b1 = 1;\nexport const b2 = 2;\n",
    ...change,
  }))
    put(dir, path, entry);
  sh("add", "-A");
  sh("commit", "-q", "-m", "change");
  const headSha = sh("rev-parse", "HEAD").trim();
  // The coverage the pull request's test run wrote: untracked, as in CI.
  put(dir, "coverage/lcov.info", fixture("coverage.info"));
  return { dir, baseSha, headSha };
}

interface ActionOptions {
  inputs?: Record<string, string>;
  /** Leave out the git batch reader, so no git object can be read. */
  noBatch?: boolean;
}

async function actionRun(repo: { dir: string; baseSha: string; headSha: string }, options: ActionOptions = {}) {
  const { run } = await import("../../action/src/run.js");
  const inputs: Record<string, string> = { comment: "false", policy: "never", upload: "never", ...options.inputs };
  const written = new Map<string, string>();
  const outputs: Record<string, string> = {};
  const failed: string[] = [];
  const fetched: string[] = [];
  const deps = {
    getInput: (name: string) => inputs[name] ?? "",
    context: {
      eventName: "pull_request",
      sha: repo.headSha,
      repo: { owner: "octo", repo: "demo" },
      payload: { pull_request: { number: 7, base: { sha: repo.baseSha }, head: { sha: repo.headSha } } },
    },
    workspace: repo.dir,
    tempDir: join(repo.dir, ".tmp"),
    api: {
      compareDiff: async () => {
        throw new Error("no compare call was expected");
      },
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async () => {},
      updateComment: async () => {},
    },
    git: (args: string[]) => runGit(repo.dir, args),
    ...(options.noBatch ? {} : { gitBatch: (args: string[], input: string) => runGitBatch(repo.dir, args, input) }),
    indexPython: async () => ({ available: false, reason: "not-needed" }),
    readFile,
    listDir,
    writeFile: async (path: string, text: string) => {
      written.set(path, text);
    },
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
    fetch: async (url: string) => {
      fetched.push(String(url));
      return new Response("{}", { status: 404 });
    },
    now: () => new Date("2026-11-18T12:00:00.000Z"),
  };
  await run(deps as never);
  const text = written.get(outputs["report-path"] ?? "");
  if (text === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { report, fetched };
}

async function cliRun(repo: { dir: string; baseSha: string }, flags: string[] = []) {
  const { main } = await import("../src/main.js");
  const { nodeDeps } = await import("../src/nodeDeps.js");
  const deps = nodeDeps(repo.dir);
  let out = "";
  let err = "";
  deps.stdout = (text) => {
    out += text;
  };
  deps.stderr = (text) => {
    err += text;
  };
  const code = await main(["check", "--base", repo.baseSha, "--format", "json", ...flags], deps);
  if (out === "") throw new Error(`no report was printed (exit ${code}): ${err}`);
  const report = JSON.parse(out) as Report;
  expectValidReport(report);
  return { code, report };
}

const configMessages = (report: Report) => report.messages.filter((m) => m.code === "CONFIG_CHANGED_IN_DIFF");
const codes = (report: Report) => report.messages.map((m) => m.code);

/** The CLI with --base gives the same verdict, diff coverage, threshold and messages as the Action. */
function expectSame(cli: { code: number; report: Report }, action: Report, label: string): void {
  expect(cli.report.verdict, label).toBe(action.verdict);
  expect(cli.report.diffCoverage?.percent, label).toBe(action.diffCoverage?.percent);
  expect(cli.report.diffCoverage?.threshold, label).toBe(action.diffCoverage?.threshold);
  // The accept label is the Action's alone.
  const shared = (report: Report) => report.messages.filter((m) => !m.code.startsWith("TEST_INTEGRITY_ACCEPT"));
  expect(shared(cli.report), label).toEqual(shared(action));
  expect(cli.code, label).toBe(action.verdict === "fail" ? 1 : 0);
}

describe("CORE-95 fixtures: a real repository whose pull request edits the config", () => {
  it('AC-2: threshold 80 as an input and coverage.exclude ["**"] added in the change: the base config is used and the run fails below the threshold', async () => {
    const repo = repository({ [CONFIG]: fixture("base-ci.yml") }, { [CONFIG]: fixture("exclude-all/ci.yml") });
    const { report } = await actionRun(repo, { inputs: { threshold: "80" } });
    // Control: the change's own copy excludes every file, which passed as NO_COVERABLE_CHANGES.
    expect(codes(report)).not.toContain("NO_COVERABLE_CHANGES");
    expect(report.diffCoverage?.percent).toBe(50);
    expect(report.verdict).toBe("fail");
    expect(codes(report)).toContain("DIFF_COVERAGE_BELOW_THRESHOLD");
    const config = configMessages(report);
    expect(config.map((m) => m.level)).toEqual(["warn"]);
    expect(config[0]?.text).toContain("`.pharn/ci.yml` as it is at the merge base");
    expect(config[0]?.text).toContain("applies after merge");
    expectSame(await cliRun(repo, ["--threshold", "80"]), report, "CLI --base");
  });

  it("AC-3: the change points coverage.file at a coverage file it commits: the base value is used", async () => {
    const repo = repository(
      { [CONFIG]: fixture("base-ci.yml") },
      { [CONFIG]: fixture("coverage-file/ci.yml"), "coverage/committed.info": fixture("coverage-file/committed.info") },
    );
    const { report } = await actionRun(repo);
    // Control: the committed file marks every line covered (100%); the base config names coverage/lcov.info (50%).
    expect(report.diffCoverage?.percent).toBe(50);
    expect(codes(report)).not.toContain("COVERAGE_FILE_TRACKED");
    expect(configMessages(report).map((m) => m.level)).toEqual(["warn"]);
    expectSame(await cliRun(repo), report, "CLI --base");
  });

  it("AC-4: the change raises threshold 80 to 90 in the config with no threshold input: 80 applies and the message says the edit applies after merge", async () => {
    const repo = repository(
      { [CONFIG]: fixture("threshold-raised/base-ci.yml") },
      { [CONFIG]: fixture("threshold-raised/ci.yml") },
    );
    const { report } = await actionRun(repo);
    // Control: the change's own copy would make it 90.
    expect(report.diffCoverage?.threshold).toBe(80);
    const below = report.messages.find((m) => m.code === "DIFF_COVERAGE_BELOW_THRESHOLD");
    expect(below?.text).toContain("threshold of 80%");
    const config = configMessages(report);
    expect(config).toHaveLength(1);
    expect(config[0]?.text).toContain("the change to it applies after merge");
    expectSame(await cliRun(repo), report, "CLI --base");
  });

  it("AC-5: the change adds a config where none existed: the defaults apply and its dependencies.lookup: true turns no lookup on", async () => {
    const manifest = (deps: Record<string, string>) =>
      `${JSON.stringify({ name: "demo", dependencies: deps }, null, 2)}\n`;
    const repo = repository(
      { "package.json": manifest({}) },
      { [CONFIG]: fixture("added/ci.yml"), "package.json": manifest({ "left-pad": "1.3.0" }) },
    );
    const added = await actionRun(repo, { inputs: { "coverage-file": "coverage/lcov.info" } });
    // Control: the same repository with the lookup mode set by the input looks the added package up.
    const lookup = await actionRun(repo, { inputs: { "coverage-file": "coverage/lcov.info", dependencies: "lookup" } });
    expect(lookup.fetched.some((url) => url.includes("left-pad"))).toBe(true);
    expect(added.fetched).toEqual([]);
    // No config: nothing is excluded (the copy the change adds excludes every file).
    expect(added.report.diffCoverage?.percent).toBe(25);
    const config = configMessages(added.report);
    expect(config.map((m) => m.level)).toEqual(["warn"]);
    expect(config[0]?.text).toContain("`.pharn/ci.yml` is new in this change");
    expectSame(await cliRun(repo, ["--coverage", "coverage/lcov.info"]), added.report, "CLI --base");
  });

  it("AC-6: the base copy cannot be read under a threshold: an error whose text names fetch-depth: 0", async () => {
    // A symbolic link at the merge base is never followed, so the base copy is unreadable.
    const repo = repository(
      { "config/base.yml": fixture("base-ci.yml"), [CONFIG]: { symlink: "../config/base.yml" } },
      { [CONFIG]: { symlink: "../config/other.yml" }, "config/other.yml": fixture("exclude-all/ci.yml") },
    );
    const symlinked = await actionRun(repo, { inputs: { threshold: "80", "coverage-file": "coverage/lcov.info" } });
    // Without a git batch reader nothing at the merge base can be read either.
    const unbatched = await actionRun(
      repository({ [CONFIG]: fixture("base-ci.yml") }, { [CONFIG]: fixture("exclude-all/ci.yml") }),
      { inputs: { threshold: "80" }, noBatch: true },
    );
    for (const [label, report] of [
      ["symbolic link at the merge base", symlinked.report],
      ["no git batch reader", unbatched.report],
    ] as const) {
      const config = configMessages(report);
      expect(
        config.map((m) => m.level),
        label,
      ).toEqual(["error"]);
      expect(config[0]?.text, label).toContain("`fetch-depth: 0`");
      expect(report.verdict, label).toBe("fail");
    }
    // Control: the run continued with no config, so nothing was excluded (25%), not the change's "**" copy.
    expect(symlinked.report.diffCoverage?.percent).toBe(25);
    expectSame(
      await cliRun(repo, ["--threshold", "80", "--coverage", "coverage/lcov.info"]),
      symlinked.report,
      "CLI --base",
    );
  });

  it("AC-7: the same rule holds for a config named by the config input and --config", async () => {
    const path = "config/pharn.yml";
    const repo = repository({ [path]: fixture("base-ci.yml") }, { [path]: fixture("exclude-all/ci.yml") });
    const { report } = await actionRun(repo, { inputs: { threshold: "80", config: path } });
    expect(report.diffCoverage?.percent).toBe(50);
    expect(report.verdict).toBe("fail");
    const config = configMessages(report);
    expect(config).toHaveLength(1);
    expect(config[0]?.text).toContain("`config/pharn.yml` as it is at the merge base");
    expectSame(await cliRun(repo, ["--threshold", "80", "--config", path]), report, "CLI --base");
  });
});
