import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC tests are written before TI14 exists, so nothing the build
// adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

function edit(path: string, removed: string, added: string): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, "@@ -3 +3 @@", `-${removed}`, `+${added}`].join("\n")}\n`;
}

async function run(diff: string, configPath?: string) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" },
    ...(configPath === undefined ? {} : { configPath }),
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const ti14 = (report: Awaited<ReturnType<typeof run>>) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI14");

describe("TI14: which file is the config", () => {
  it("AC-5: the config named by the config path is read; a config path outside the repository gives nothing", async () => {
    const custom = edit("config/pharn.yml", "  threshold: 80", "  threshold: 70");

    // In the repository, relative and absolute.
    for (const configPath of ["config/pharn.yml", `${REPO_ROOT}/config/pharn.yml`]) {
      const signals = ti14(await run(custom, configPath));
      expect(signals, configPath).toHaveLength(1);
      expect(signals[0]).toMatchObject({ severity: "block", path: "config/pharn.yml" });
    }

    // Outside the repository: the config in use cannot be in the diff, so nothing is read from it.
    for (const configPath of ["/elsewhere/pharn.yml", "../pharn.yml"]) {
      expect(ti14(await run(custom, configPath)), configPath).toEqual([]);
      const defaultConfig = edit(".pharn/ci.yml", "  threshold: 80", "  threshold: 70");
      expect(ti14(await run(defaultConfig, configPath)), `${configPath} with the default file`).toEqual([]);
    }

    // The default file is the config when no path is given.
    expect(ti14(await run(edit(".pharn/ci.yml", "  threshold: 80", "  threshold: 70")))).toHaveLength(1);
  });
});
