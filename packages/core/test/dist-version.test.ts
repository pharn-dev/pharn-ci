import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The committed Action bundle is built from the current sources, so the version the comment footer and the report's
// tool.version show is the package version. That the bundle is fresh is checked by the existing dist tests and by CI;
// this checks the compiled VERSION, the declaration esbuild emits under its `// ../core/src/version.ts` module comment,
// against the root package.json. Files are read inside the test body. (It replaces the per-release
// ac-release<version>-dist test, which pinned the version literally and was renamed at every release.)

describe("the committed Action bundle", () => {
  it("packages/action/dist/index.js declares the core VERSION as the root package.json version", () => {
    const version: string = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version;
    const dist = readFileSync(new URL("../../action/dist/index.js", import.meta.url), "utf8");
    const declared = [...dist.matchAll(/^\/\/ \.\.\/core\/src\/version\.ts\r?\nvar VERSION\d* = "([^"]*)";$/gm)].map(
      (match) => match[1],
    );
    expect(declared, "the compiled core VERSION").toEqual([version]);
  });
});
