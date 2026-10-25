import { describe, expect, it } from "vitest";

// The core entry point is loaded inside the test body: the AC test is written before `vite.config.*` joins the
// test-config names, so nothing that depends on the change may run while the file loads.

interface Core {
  isTestConfigFile(path: string): boolean;
  selectTestSourcePaths(diff: readonly unknown[]): { base: string[]; head: string[] };
  parseUnifiedDiff(text: string): unknown[];
}

const MODIFIED_VITE = [
  "diff --git a/web/vite.config.ts b/web/vite.config.ts",
  "index 1111111..2222222 100644",
  "--- a/web/vite.config.ts",
  "+++ b/web/vite.config.ts",
  "@@ -5 +5 @@ export default defineConfig({",
  '-    include: ["src/**/*.test.ts"],',
  '+    include: ["src/**/*.fast.test.ts"],',
  "",
].join("\n");

describe("test sources: vite.config.* is a test-config name", () => {
  it("AC-1: the predicate is true for vite.config.ts, web/vite.config.mjs and the other config names, false for vite.config. and src/vite.ts, and a modified web/vite.config.ts is selected on both sides", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;

    for (const path of [
      "vite.config.ts",
      "web/vite.config.mjs",
      "vitest.config.mts",
      "jest.config.json",
      ".mocharc.yml",
      "pytest.ini",
    ]) {
      expect(core.isTestConfigFile(path), `${path} is a test-config file`).toBe(true);
    }
    for (const path of ["vite.config.", "src/vite.ts"]) {
      expect(core.isTestConfigFile(path), `${path} is not a test-config file`).toBe(false);
    }

    const selection = core.selectTestSourcePaths(core.parseUnifiedDiff(MODIFIED_VITE));
    expect(selection.base, "base side").toEqual(["web/vite.config.ts"]);
    expect(selection.head, "head side").toEqual(["web/vite.config.ts"]);
  });
});
