import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CliDeps, EXIT_ERROR, EXIT_FAIL, EXIT_OK, main } from "../src/main.js";
import { nodeDeps } from "../src/nodeDeps.js";

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (p: string) => readFileSync(new URL(p, FIXTURES), "utf8");

interface Fake extends CliDeps {
  out: string;
  err: string;
  gitCalls: string[][];
}

function fakeDeps(files: Record<string, string>, gitOverrides: Record<string, string | Error> = {}): Fake {
  const fake: Fake = {
    cwd: "/repo/sub",
    out: "",
    err: "",
    gitCalls: [],
    async git(args) {
      fake.gitCalls.push(args);
      const override = gitOverrides[args[0] as string];
      if (override instanceof Error) throw override;
      if (override !== undefined) return override;
      if (args[0] === "rev-parse") return "/repo\n";
      if (args[0] === "diff") return fixture("golden/pr.diff");
      if (args[0] === "ls-files") return `${fixture("golden/files.txt").trim().split("\n").join("\0")}\0`;
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
    async readFile(path) {
      return files[path] ?? null;
    },
    resolvePath: (...segments) =>
      segments.reduce((acc, s) => (s.startsWith("/") ? s : `${acc.replace(/\/$/, "")}/${s.replace(/^\.\//, "")}`), ""),
    stdout: (t) => {
      fake.out += t;
    },
    stderr: (t) => {
      fake.err += t;
    },
  };
  return fake;
}

const coverage = {
  "/repo/sub/lcov.info": fixture("golden/coverage.info").replaceAll("/home/runner/work/demo/demo", "/repo"),
};

describe("cli main", () => {
  it("prints JSON to stdout and exits 1 when below the threshold", async () => {
    const deps = fakeDeps(coverage);
    const code = await main(["check", "--coverage", "lcov.info", "--threshold", "80", "--format", "json"], deps);
    expect(code).toBe(EXIT_FAIL);
    expect(deps.err).toBe("");
    const report = JSON.parse(deps.out);
    expect(report.verdict).toBe("fail");
    expect(report.diffCoverage.percent).toBe(71.43);
  });

  it("exits 0 when the threshold is met, and diffs against origin/main by default", async () => {
    const deps = fakeDeps(coverage);
    expect(await main(["check", "--coverage", "lcov.info", "--threshold", "71.43"], deps)).toBe(EXIT_OK);
    expect(deps.out).toContain("## ✅ pharn-ci: pass");
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
    [["check"], "no coverage file"],
    [["check", "--coverage", "x", "--config", "missing.yml"], "config file not found"],
    [
      ["check", "--coverage", "x", "--base=--output=/tmp/pwned"],
      '--base "--output=/tmp/pwned" must not start with "-"',
    ],
  ])("exits 2 for %j", async (argv, message) => {
    const deps = fakeDeps({});
    expect(await main(argv, deps)).toBe(EXIT_ERROR);
    expect(deps.err).toContain(message);
    expect(deps.out).toBe("");
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
