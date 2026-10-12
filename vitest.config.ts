import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test workspace packages from source, no build needed.
    alias: {
      "@pharn-ci/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    // PHARN's gate runner sets PHARN_TEST_RESULTS to the path where it reads per-test results
    // (pharn.config.json `testResults`). Unset in normal runs and CI, so output there is unchanged.
    ...(process.env.PHARN_TEST_RESULTS
      ? { reporters: ["default", "json"], outputFile: { json: process.env.PHARN_TEST_RESULTS } }
      : {}),
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
