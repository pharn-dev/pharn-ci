import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Review finding 24: the Action runs packages/action/dist/index.js, and a file under dist that a build does not write
// would ship in every consumer's checkout without being rebuilt and compared by CI, so the committed list is pinned here.
// scripts/bundle.mjs writes exactly two files for the Action: the bundle and, beside it, typescript.js, the TypeScript
// parser the bundle loads on the first parse of a test file (action-bundle-size; its sha256 is pinned in
// packages/action/src/vendored-typescript-pin.ts). No source map, no chunk, no metafile, and no third file.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIST = "packages/action/dist";
const BUNDLE = `${DIST}/index.js`;
const VENDORED = `${DIST}/typescript.js`;

describe("the committed action dist is two files: the bundle and the vendored TypeScript parser", () => {
  it("git ls-files packages/action/dist is exactly packages/action/dist/index.js and packages/action/dist/typescript.js", () => {
    const listed = execFileSync("git", ["ls-files", "-z", "--", DIST], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter((path) => path !== "");
    expect(listed).toEqual([BUNDLE, VENDORED]);
  });

  it("the dist directory on disk holds only the file a build makes", () => {
    const dir = join(ROOT, DIST);
    if (!existsSync(dir)) return;
    expect(readdirSync(dir, { recursive: true }).map(String).sort()).toEqual(["index.js", "typescript.js"]);
  });
});
