import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.mts"],
    globals: true,
    setupFiles: ["./test/setup.mts"],
  },
});
