import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// main() and the fixtures are loaded inside each test body: the AC tests are written before format selection and
// fixtures/golden-cobertura/ exist, so nothing that depends on them may run while the file loads. The CLI runs
// against in-memory deps: a fake repo rooted at REPO_ROOT whose git returns the golden diff and files list.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const REPO_ROOT = "/home/runner/work/demo/demo";
const SHA = "1111111111111111111111111111111111111111";

function fakeRepo(files: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const contents = new Map(Object.entries(files).map(([path, text]) => [resolve(REPO_ROOT, path), text]));
  const deps = {
    cwd: REPO_ROOT,
    git: async (args: string[]) => {
      if (args.includes("ls-files")) {
        const paths = fixture("golden/files.txt").trim().split("\n");
        return args.includes("-z") ? `${paths.join("\0")}\0` : `${paths.join("\n")}\n`;
      }
      if (args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
      if (args.includes("diff")) return fixture("golden/pr.diff");
      return `${SHA}\n`;
    },
    readFile: async (path: string) => contents.get(path) ?? null,
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
  };
  return {
    deps,
    stdout: () => out.join(""),
    stderr: () => err.join(""),
    formatLines: () =>
      err
        .join("")
        .split("\n")
        .filter((line) => line.startsWith("coverage: ")),
  };
}

async function runCli(argv: string[], files: Record<string, string>) {
  const { main } = await import("../src/main.js");
  const repo = fakeRepo(files);
  const code = await main(argv, repo.deps);
  return { code, ...repo };
}

describe("pharn-ci check --coverage-format", () => {
  it("AC-16: auto-detects the golden Cobertura file and logs one format line on stderr", async () => {
    const run = await runCli(["check", "--coverage", "coverage.xml", "--format", "json"], {
      "coverage.xml": fixture("golden-cobertura/coverage.xml"),
    });
    const report = JSON.parse(run.stdout());
    expect(report.diffCoverage.format).toBe("cobertura");
    expect(run.formatLines()).toEqual(["coverage: cobertura (auto-detected)"]);
  });

  it("AC-17: an explicit format from the flag or the config is logged as configured, the flag winning", async () => {
    const lcov = fixture("golden/coverage.info");
    const argv = ["check", "--coverage", "coverage/lcov.info", "--format", "json"];

    const fromFlag = await runCli([...argv, "--coverage-format", "lcov"], { "coverage/lcov.info": lcov });
    expect(fromFlag.formatLines(), "flag lcov").toEqual(["coverage: lcov (configured)"]);

    const fromConfig = await runCli(argv, {
      "coverage/lcov.info": lcov,
      ".pharn/ci.yml": "coverage:\n  format: lcov\n",
    });
    expect(fromConfig.formatLines(), "config lcov").toEqual(["coverage: lcov (configured)"]);

    const flagOverConfig = await runCli([...argv, "--coverage-format", "cobertura"], {
      "coverage/lcov.info": lcov,
      ".pharn/ci.yml": "coverage:\n  format: lcov\n",
    });
    expect(flagOverConfig.formatLines(), "flag cobertura over config lcov").toEqual([
      "coverage: cobertura (configured)",
    ]);
  });

  it("AC-18: stdout carries only the JSON report, and an unknown --coverage-format exits 2 naming the value", async () => {
    const lcov = fixture("golden/coverage.info");
    const auto = await runCli(
      ["check", "--coverage", "coverage/lcov.info", "--format", "json", "--coverage-format", "auto"],
      { "coverage/lcov.info": lcov },
    );
    const report = JSON.parse(auto.stdout());
    expect(report.schemaVersion).toBe(2);
    expect(report.diffCoverage.format).toBe("lcov");
    expect(auto.stdout()).not.toContain("coverage: lcov");
    expect(auto.formatLines()).toEqual(["coverage: lcov (auto-detected)"]);

    const clover = await runCli(
      ["check", "--coverage", "coverage/lcov.info", "--format", "json", "--coverage-format", "clover"],
      { "coverage/lcov.info": lcov },
    );
    expect(clover.code).toBe(2);
    expect(clover.stderr()).toContain("clover");
  });
});
