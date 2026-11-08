import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// Flaky tests (A6) in the CLI: `pharn-ci test -- <command>` with its real Node deps runs a tiny fixture command
// (fixtures/junit/command.mjs, run with process.execPath) that copies a JUnit fixture and exits with a given code; and
// `pharn-ci check --junit` fills the report's flaky object. No network call is ever made.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/junit/", import.meta.url));
const COMMAND = join(FIXTURES, "command.mjs");
const FAILING = join(FIXTURES, "failing.xml");
const QUARANTINE = join(FIXTURES, "quarantine.json");

let dir: string;

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-test-cmd-")));
  writeFileSync(join(dir, "partial.json"), JSON.stringify(["api.users::creates a user"]));
  writeFileSync(join(dir, "bad.json"), JSON.stringify({ ids: [] }));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function cli(args: string[], cwd = dir) {
  const { main } = await import("../src/main.js");
  const { nodeDeps } = await import("../src/nodeDeps.js");
  const deps = nodeDeps(cwd);
  let out = "";
  let err = "";
  deps.stdout = (text) => {
    out += text;
  };
  deps.stderr = (text) => {
    err += text;
  };
  const code = await main(args, deps);
  return { code, out, err };
}

/** `pharn-ci test` running the fixture command that writes `out/<name>` from failing.xml and exits with `exit`. */
const withJunit = (name: string, exit: number, options: string[]) =>
  cli([
    "test",
    "--junit",
    `out/${name}`,
    ...options,
    "--",
    process.execPath,
    COMMAND,
    "junit",
    FAILING,
    `out/${name}`,
    String(exit),
  ]);

describe("pharn-ci test", { timeout: 60_000 }, () => {
  it("passes the command's own exit code through", async () => {
    expect((await cli(["test", "--", process.execPath, COMMAND, "exit", "0"])).code).toBe(0);
    expect((await cli(["test", "--", process.execPath, COMMAND, "exit", "3"])).code).toBe(3);
  });

  it("runs the command without a shell: every argument arrives as it was given", async () => {
    const tricky = ["$(echo hi)", "a b", "; rm -rf /", "*", "'q'"];
    const { code } = await cli(["test", "--", process.execPath, COMMAND, "args", join(dir, "args.json"), ...tricky]);
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "args.json"), "utf8"))).toEqual(tricky);
  });

  it("exits 0 when the command failed and every failed test is quarantined", async () => {
    const { code, err } = await withJunit("all.xml", 1, ["--quarantine-file", QUARANTINE]);
    expect(code).toBe(0);
    expect(err).toContain("pharn-ci: JUnit: 3 test(s) in 1 file(s), 2 failed (2 quarantined, 0 not quarantined)");
    expect(err).toContain("pharn-ci: the command exited 1 and every failed test is quarantined, so pharn-ci exits 0");
  });

  it("keeps the command's code when a failed test is not quarantined, or there is no list", async () => {
    const partial = await withJunit("partial.xml", 1, ["--quarantine-file", "partial.json"]);
    expect(partial.code).toBe(1);
    expect(partial.err).toContain("2 failed (1 quarantined, 1 not quarantined)");
    expect((await withJunit("none.xml", 2, [])).code).toBe(2);
  });

  it("keeps the command's code when no JUnit file was found", async () => {
    const { code, err } = await cli([
      "test",
      "--junit",
      "out/missing.xml",
      "--quarantine-file",
      QUARANTINE,
      "--",
      process.execPath,
      COMMAND,
      "exit",
      "1",
    ]);
    expect(code).toBe(1);
    expect(err).toContain("pharn-ci: JUNIT_NOT_FOUND:");
  });

  it("exits 128 + n when a signal stopped the command", async () => {
    const { code, err } = await cli(["test", "--", process.execPath, COMMAND, "signal", "SIGTERM"]);
    expect(code).toBe(128 + 15);
    expect(err).toContain("stopped by SIGTERM");
  });

  it("prints what it would do with --dry-run and runs nothing", async () => {
    const { code, out } = await cli([
      "test",
      "--dry-run",
      "--junit",
      "out/x.xml",
      "--quarantine-file",
      QUARANTINE,
      "--",
      process.execPath,
      COMMAND,
      "args",
      join(dir, "dry.json"),
      "a b",
    ]);
    expect(code).toBe(0);
    expect(out).toContain(`pharn-ci test (dry run): would run: ${process.execPath} ${COMMAND} args`);
    expect(out).toContain('"a b"');
    expect(out).toContain("pharn-ci test (dry run): would read JUnit from: out/x.xml");
    expect(out).toContain("pharn-ci test (dry run): quarantine list: 3 test id(s)");
    expect(() => readFileSync(join(dir, "dry.json"))).toThrow();
  });

  it("exits 2 on a usage or file problem", async () => {
    expect((await cli(["test"])).code).toBe(2);
    expect((await cli(["test", "--"])).code).toBe(2);
    expect((await cli(["test", "--bogus", "--", "x"])).code).toBe(2);
    expect((await cli(["test", "--junit", "../up/*.xml", "--", "x"])).code).toBe(2);
    const bad = await cli(["test", "--quarantine-file", "bad.json", "--", "x"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("must be a JSON array of test ids");
    expect((await cli(["test", "--quarantine-file", "nope.json", "--", "x"])).code).toBe(2);
    const missing = await cli(["test", "--", join(dir, "no-such-command")]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("pharn-ci: could not run");
  });

  it("prints its help", async () => {
    const { code, out } = await cli(["test", "--help"]);
    expect(code).toBe(0);
    expect(out).toContain("pharn-ci test [options] -- <command> [args...]");
  });
});

describe("pharn-ci check --junit", { timeout: 60_000 }, () => {
  let repo: string;
  beforeAll(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-check-junit-")));
    const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
    sh("init", "-q", "-b", "main");
    sh("config", "user.email", "test@example.com");
    sh("config", "user.name", "test");
    sh("config", "commit.gpgsign", "false");
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src/a.ts"), "export const a = 1;\n");
    sh("add", "-A");
    sh("commit", "-q", "-m", "base");
    sh("checkout", "-q", "-b", "feature");
    writeFileSync(join(repo, "src/a.ts"), "export const a = 2;\n");
    sh("add", "-A");
    sh("commit", "-q", "-m", "feature");
    mkdirSync(join(repo, "coverage"));
    writeFileSync(join(repo, "coverage/lcov.info"), `SF:${repo}/src/a.ts\nDA:1,1\nend_of_record\n`);
    mkdirSync(join(repo, "reports"));
    writeFileSync(join(repo, "reports/api.xml"), readFileSync(FAILING, "utf8"));
  });
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  const check = (extra: string[]) =>
    cli(["check", "--base", "main", "--coverage", "coverage/lcov.info", "--format", "json", ...extra], repo);

  it("fills flaky and applies --quarantine-file; the verdict ignores the failed tests", async () => {
    const { code, out } = await check(["--junit", "reports/*.xml", "--quarantine-file", QUARANTINE]);
    expect(code).toBe(0);
    const report = JSON.parse(out);
    expectValidReport(report);
    expect(report.flaky).toEqual({
      uploaded: false,
      testCount: 3,
      failed: 2,
      quarantined: ["api.orders::cancels an order", "api.users::creates a user"],
      quarantinedFailures: 2,
      unquarantinedFailures: 0,
    });
    expect(report.verdict).not.toBe("fail");
  });

  it("adds nothing without --junit, and refuses a pattern outside the working directory", async () => {
    const report = JSON.parse((await check([])).out);
    expect(report.flaky).toBeUndefined();
    const outside = await check(["--junit", "/tmp/*.xml"]);
    expect(outside.code).toBe(2);
    expect(outside.err).toContain('--junit "/tmp/*.xml"');
  });
});
