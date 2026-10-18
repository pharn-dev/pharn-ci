import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CliDeps } from "../src/main.js";

// main() is imported inside each test body, like the other AC tests written before the build.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (p: string) => readFileSync(new URL(p, FIXTURES), "utf8");

interface Fake extends CliDeps {
  out: string;
  err: string;
}

/** A repo at /repo, run from /repo/sub, whose diff and tracked files are fixtures/golden/. */
function fakeDeps(files: Record<string, string>): Fake {
  const fake: Fake = {
    cwd: "/repo/sub",
    out: "",
    err: "",
    async git(args) {
      if (args[0] === "rev-parse") return "/repo\n";
      if (args[0] === "diff") return fixture("golden/pr.diff");
      if (args[0] === "ls-files") return `${fixture("golden/files.txt").trim().split("\n").join("\0")}\0`;
      if (args[0] === "ls-tree") return "";
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

const COVERAGE = {
  "/repo/sub/lcov.info": fixture("golden/coverage.info").replaceAll("/home/runner/work/demo/demo", "/repo"),
};
const CONFIG = "/repo/.pharn/ci.yml";

describe("pharn-ci check --exclude", () => {
  it("AC-18: merges --exclude flags with coverage.exclude and recomputes coverage and the exit code", async () => {
    const { main, EXIT_FAIL, EXIT_OK } = await import("../src/main.js");
    const files = { ...COVERAGE, [CONFIG]: "coverage:\n  exclude:\n    - src/new.ts\n" };
    const args = (threshold: string) => [
      "check",
      "--coverage",
      "lcov.info",
      "--threshold",
      threshold,
      "--format",
      "json",
      "--exclude",
      "src/new.ts",
      "--exclude",
      "src/utils/**",
    ];

    // Unexcluded, the golden change is 5/7 = 71.43%; without src/new.ts and src/utils/new-name.ts it is 3/4 = 75%.
    const passing = fakeDeps(files);
    const passCode = await main(args("74"), passing);
    expect(passing.err).toBe("coverage: lcov (auto-detected)\n");
    const report = JSON.parse(passing.out);
    expect(report.diffCoverage.excludedFiles).toEqual(["src/new.ts", "src/utils/new-name.ts"]);
    expect(report.diffCoverage).toMatchObject({ percent: 75, coveredLines: 3, coverableLines: 4 });
    expect(report.diffCoverage.files.map((f: { path: string }) => f.path)).toEqual(["src/math.ts"]);
    expect(report.verdict).toBe("pass");
    expect(passCode).toBe(EXIT_OK);

    const failing = fakeDeps(files);
    const failCode = await main(args("76"), failing);
    expect(failing.err).toBe("coverage: lcov (auto-detected)\n");
    expect(JSON.parse(failing.out).verdict).toBe("fail");
    expect(failCode).toBe(EXIT_FAIL);
  });

  it("AC-18: lists --exclude <glob> in the help", async () => {
    const { main, EXIT_OK } = await import("../src/main.js");
    const help = fakeDeps({});
    expect(await main(["--help"], help)).toBe(EXIT_OK);
    expect(help.out).toContain("--exclude <glob>");
  });

  it("AC-19: exits 2 naming a rejected pattern from --exclude or from coverage.exclude", async () => {
    const { main, EXIT_ERROR } = await import("../src/main.js");

    const fromFlag = fakeDeps(COVERAGE);
    expect(await main(["check", "--coverage", "lcov.info", "--exclude", "src/{a,b}.ts"], fromFlag)).toBe(EXIT_ERROR);
    expect(fromFlag.err).toContain("src/{a,b}.ts");
    expect(fromFlag.out).toBe("");

    const fromConfig = fakeDeps({ ...COVERAGE, [CONFIG]: 'coverage:\n  exclude:\n    - "../secret/**"\n' });
    expect(await main(["check", "--coverage", "lcov.info"], fromConfig)).toBe(EXIT_ERROR);
    expect(fromConfig.err).toContain("../secret/**");
    expect(fromConfig.out).toBe("");
  });
});
