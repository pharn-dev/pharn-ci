import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_FAIL, EXIT_OK, main } from "../src/main.js";
import { nodeDeps } from "../src/nodeDeps.js";
import { coverage, fakeDeps } from "./fake-deps.js";

describe("cli main", () => {
  it("prints JSON to stdout and exits 1 when below the threshold", async () => {
    const deps = fakeDeps(coverage);
    const code = await main(["check", "--coverage", "lcov.info", "--threshold", "80", "--format", "json"], deps);
    expect(code).toBe(EXIT_FAIL);
    expect(deps.err).toBe("coverage: lcov (auto-detected)\n");
    const report = JSON.parse(deps.out);
    expect(report.verdict).toBe("fail");
    expect(report.diffCoverage.percent).toBe(71.43);
  });

  it("exits 0 when the threshold is met, and diffs against origin/main by default", async () => {
    const deps = fakeDeps(coverage);
    expect(await main(["check", "--coverage", "lcov.info", "--threshold", "71.42"], deps)).toBe(EXIT_OK);
    expect(deps.out).toContain("## 🛡️ pharn-ci · ✅ Pass");
    const diff = deps.gitCalls.find((a) => a[0] === "diff");
    expect(diff).toContain("--unified=0");
    expect(diff?.at(-1)).toBe("origin/main...HEAD");
    expect(diff?.at(-2)).toBe("--end-of-options");
  });

  it("uses --base", async () => {
    const deps = fakeDeps(coverage);
    await main(["check", "--coverage", "lcov.info", "--base", "develop"], deps);
    expect(deps.gitCalls.find((a) => a[0] === "diff")?.at(-1)).toBe("develop...HEAD");
  });

  it("passes the only user-influenced revision to git after --end-of-options", async () => {
    const deps = fakeDeps(coverage);
    await main(["check", "--coverage", "lcov.info", "--base", "topic/-x"], deps);
    expect(deps.gitCalls).toEqual([
      ["rev-parse", "--show-toplevel"],
      [
        "diff",
        "--unified=0",
        "--no-color",
        "--no-ext-diff",
        "--find-renames",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--end-of-options",
        "topic/-x...HEAD",
      ],
      // F-01: tracked files are listed from the repo root, whatever directory the CLI runs in.
      ["ls-files", "-z", "--full-name", "--", ":/"],
      // F-10: file sizes in HEAD, to report empty agent setup files.
      ["ls-tree", "-r", "-l", "-z", "--full-tree", "HEAD"],
    ]);
  });

  it("never runs git with a --base that starts with -x", async () => {
    const deps = fakeDeps(coverage);
    expect(await main(["check", "--coverage", "lcov.info", "--base=-x"], deps)).toBe(EXIT_ERROR);
    expect(deps.err).toContain('--base "-x" must not start with "-"');
    expect(deps.gitCalls).toEqual([]);
  });

  it("reads .pharn/ci.yml from the repo root, with CLI flags overriding it", async () => {
    const files = {
      "/repo/.pharn/ci.yml": "coverage:\n  file: cov/lcov.info\n  threshold: 90\n",
      "/repo/cov/lcov.info": coverage["/repo/sub/lcov.info"],
    };
    const fromConfig = fakeDeps(files);
    expect(await main(["check", "--format", "json"], fromConfig)).toBe(EXIT_FAIL);
    expect(JSON.parse(fromConfig.out).diffCoverage.threshold).toBe(90);

    const overridden = fakeDeps(files);
    expect(await main(["check", "--format", "json", "--threshold", "50"], overridden)).toBe(EXIT_OK);
    expect(JSON.parse(overridden.out).diffCoverage.threshold).toBe(50);
  });

  it("reports a missing coverage file in the report", async () => {
    const deps = fakeDeps({});
    expect(await main(["check", "--coverage", "nope.info", "--threshold", "80", "--format", "json"], deps)).toBe(
      EXIT_FAIL,
    );
    expect(JSON.parse(deps.out).messages[0]).toMatchObject({ code: "COVERAGE_FILE_MISSING", level: "error" });
  });

  it.each([
    [[], "Usage:"],
    [["lint"], 'unknown command "lint"'],
    [["check", "--nope"], "Unknown option"],
    [["check", "--coverage", "x", "--format", "xml"], '--format must be "md" or "json"'],
    [["check", "--coverage", "x", "--threshold", "abc"], "--threshold must be a number"],
    [["check", "--coverage", "x", "--config", "missing.yml"], "config file not found"],
    [["check", "--coverage", "x", "--config", ".pharn/ci.yml"], "config file not found: /repo/sub/.pharn/ci.yml"],
    [
      ["check", "--coverage", "x", "--base=--output=/tmp/pwned"],
      '--base "--output=/tmp/pwned" must not start with "-"',
    ],
    // `--base=-x`: parseArgs refuses the two-token `--base -x` as an ambiguous option argument.
    [["check", "--coverage", "x", "--base=-x"], '--base "-x" must not start with "-"'],
  ])("exits 2 for %j", async (argv, message) => {
    const deps = fakeDeps({});
    expect(await main(argv, deps)).toBe(EXIT_ERROR);
    expect(deps.err).toContain(message);
    expect(deps.out).toBe("");
  });

  // Replaces the old `["check"]` exit-2 row: with no coverage path set, the CLI now looks for a report, and
  // reports COVERAGE_FILE_MISSING when it finds none.
  it("reports COVERAGE_FILE_MISSING with exit 0 when no coverage path is set and none is discovered", async () => {
    const deps = fakeDeps({});
    deps.listDir = async () => null;
    expect(await main(["check", "--format", "json"], deps)).toBe(EXIT_OK);
    const report = JSON.parse(deps.out);
    expect(report.messages[0].code).toBe("COVERAGE_FILE_MISSING");
    expect(report.messages[0].level).toBe("warn");
    expect(report.messages[0].text).toContain("coverage/lcov.info");
    expect(report.messages[0].text).toContain("coverage.file");
    expect(deps.err).not.toContain("(auto-discovered)");
  });

  it.each([
    [["--coverage-format", "xml"], '--coverage-format must be one of: lcov, cobertura, auto (got "xml")'],
    [["--exclude", "/abs"], '--exclude "/abs" must not start with "/"'],
  ])("reports a malformed %j before running git", async (flags, message) => {
    const deps = fakeDeps(coverage);
    expect(await main(["check", "--coverage", "lcov.info", ...flags], deps)).toBe(EXIT_ERROR);
    expect(deps.err).toContain(message);
    expect(deps.gitCalls).toEqual([]);
  });

  it("exits 2 with a hint when the base cannot be diffed", async () => {
    const deps = fakeDeps(coverage, { diff: new Error("fatal: bad revision 'origin/main...HEAD'") });
    expect(await main(["check", "--coverage", "lcov.info"], deps)).toBe(EXIT_ERROR);
    expect(deps.err).toContain('could not diff against "origin/main"');
    expect(deps.err).toContain("bad revision");
  });

  it("exits 2 for an invalid config file", async () => {
    const deps = fakeDeps({ "/repo/.pharn/ci.yml": "coverage:\n  treshold: 1\n" });
    expect(await main(["check", "--coverage", "x"], deps)).toBe(EXIT_ERROR);
    expect(deps.err).toContain('/repo/.pharn/ci.yml: unknown key "coverage.treshold"');
  });

  it("prints help and version", async () => {
    const help = fakeDeps({});
    expect(await main(["--help"], help)).toBe(EXIT_OK);
    expect(help.out).toContain("pharn-ci check");
    const version = fakeDeps({});
    expect(await main(["-v"], version)).toBe(EXIT_OK);
    expect(version.out).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});

describe("cli end to end against a real git repo", () => {
  let dir: string;
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });

  beforeAll(() => {
    // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
    dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-e2e-")));
    sh("init", "-q", "-b", "main");
    sh("config", "user.email", "test@example.com");
    sh("config", "user.name", "test");
    sh("config", "commit.gpgsign", "false");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 2;\n");
    writeFileSync(join(dir, "src/old.ts"), "export const old = 1;\nexport const keep = 2;\nexport const x = 3;\n");
    sh("add", ".");
    sh("commit", "-q", "-m", "base");
    sh("checkout", "-q", "-b", "feature");
    writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 3;\nexport const c = 4;\n");
    sh("mv", "src/old.ts", "src/renamed.ts");
    writeFileSync(join(dir, "src/renamed.ts"), "export const old = 1;\nexport const keep = 2;\nexport const y = 3;\n");
    writeFileSync(join(dir, "CLAUDE.md"), "@AGENTS.md\n");
    mkdirSync(join(dir, ".pharn"));
    writeFileSync(join(dir, ".pharn/ci.yml"), "coverage:\n  file: coverage/lcov.info\n  threshold: 75\n");
    sh("add", ".");
    sh("commit", "-q", "-m", "feature");
    mkdirSync(join(dir, "coverage"));
    // Absolute paths, as most tools write them.
    writeFileSync(
      join(dir, "coverage/lcov.info"),
      `SF:${dir}/src/math.ts\nDA:1,1\nDA:2,1\nDA:3,0\nend_of_record\nSF:${dir}/src/renamed.ts\nDA:3,1\nend_of_record\n`,
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("produces the expected report", async () => {
    const deps = nodeDeps(dir);
    let out = "";
    deps.stdout = (t) => {
      out += t;
    };
    const code = await main(["check", "--base", "main", "--format", "json"], deps);
    const report = JSON.parse(out);
    expect(report.diffCoverage).toEqual({
      format: "lcov",
      percent: 66.67,
      threshold: 75,
      coveredLines: 2,
      coverableLines: 3,
      files: [
        { path: "src/math.ts", percent: 50, coveredLines: 1, coverableLines: 2, uncoveredLines: [3] },
        { path: "src/renamed.ts", percent: 100, coveredLines: 1, coverableLines: 1, uncoveredLines: [] },
      ],
    });
    expect(report.agentSetup.files).toEqual([{ path: "CLAUDE.md", kind: "claude-md" }]);
    expect(code).toBe(EXIT_FAIL);
  });

  it("works from a subdirectory with a relative --coverage path", async () => {
    const deps = nodeDeps(join(dir, "src"));
    let out = "";
    deps.stdout = (t) => {
      out += t;
    };
    expect(
      await main(["check", "--base", "main", "--coverage", "../coverage/lcov.info", "--threshold", "60"], deps),
    ).toBe(EXIT_OK);
    expect(out).toContain("**66.67%**");
  });
});
