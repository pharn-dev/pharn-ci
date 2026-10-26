import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// release-030: the committed Action bundle is built from the 0.3.0 sources, so the version the comment footer and the
// report's tool.version show is 0.3.0. That the bundle is fresh is checked by the existing dist tests and by CI; this
// checks the compiled VERSION, the declaration esbuild emits under its `// ../core/src/version.ts` module comment. The
// bundle is read inside the test body.

describe("release-030: the committed Action bundle", () => {
  it("AC-7: packages/action/dist/index.js declares the core VERSION as 0.3.0 and holds no 0.2.0 version string", () => {
    const dist = readFileSync(new URL("../../action/dist/index.js", import.meta.url), "utf8");
    const declared = [...dist.matchAll(/^\/\/ \.\.\/core\/src\/version\.ts\r?\nvar VERSION\d* = "([^"]*)";$/gm)].map(
      (match) => match[1],
    );
    expect(declared, "the compiled core VERSION").toEqual(["0.3.0"]);
    expect(dist.includes("0.2.0"), "no 0.2.0 string in the bundle").toBe(false);
  });
});
