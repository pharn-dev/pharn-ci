import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// VERSION and every package.json are read inside the test body, like the other AC tests.

const repoFile = (path: string) => new URL(`../../../${path}`, import.meta.url);

describe("release readiness: one version everywhere", () => {
  it("AC-1: the root, core, cli and action package.json versions all equal VERSION", async () => {
    const { VERSION } = await import("../src/version.js");
    const read = (path: string) => JSON.parse(readFileSync(repoFile(path), "utf8"));

    const root = read("package.json");
    expect(root, "root package.json has a version field").toHaveProperty("version");
    expect(root.version, "package.json").toBe(VERSION);

    for (const path of ["packages/core/package.json", "packages/cli/package.json", "packages/action/package.json"]) {
      expect(read(path).version, path).toBe(VERSION);
    }
  });
});
