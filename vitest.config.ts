import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** The one source of the version, as scripts/bundle.mjs reads it: packages/core/src/version.ts uses it. */
const version: string = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

export default defineConfig({
  define: { __PHARN_VERSION__: JSON.stringify(version) },
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
