import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// release-030: the five package.json files and packages/core/src/version.ts say 0.3.0. Files are read, and the
// version module imported, inside the test body, so nothing the build changes is loaded when this file loads.

const repoFile = (path: string) => new URL(`../../../${path}`, import.meta.url);
const PACKAGES = [
  "package.json",
  "packages/core/package.json",
  "packages/cli/package.json",
  "packages/action/package.json",
  "packages/node-io/package.json",
];

describe("release-030: versions", () => {
  it("AC-1: the root, core, cli, action and node-io package.json versions and VERSION in version.ts are all 0.3.0", async () => {
    const versions = PACKAGES.map((path) => [path, JSON.parse(readFileSync(repoFile(path), "utf8")).version]);
    expect(versions).toEqual(PACKAGES.map((path) => [path, "0.3.0"]));

    const { VERSION } = await import("../src/version.js");
    expect(VERSION, "the exported VERSION").toBe("0.3.0");

    const source = readFileSync(repoFile("packages/core/src/version.ts"), "utf8");
    const declared = source.match(/^export const VERSION = "[^"]*";$/gm) ?? [];
    expect(declared, "one VERSION declaration in version.ts").toEqual(['export const VERSION = "0.3.0";']);
  });
});
