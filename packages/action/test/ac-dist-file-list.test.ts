import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Review finding 24: the Action runs packages/action/dist/index.js, and scripts/bundle.mjs writes that one file and
// nothing else (no source map, no chunk, no metafile). A second committed file under dist would ship in every
// consumer's checkout without being the bundle CI rebuilds and compares, so the committed list is pinned here.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIST = "packages/action/dist";
const BUNDLE = `${DIST}/index.js`;

describe("the committed action dist is one file", () => {
  it("git ls-files packages/action/dist is exactly packages/action/dist/index.js", () => {
    const listed = execFileSync("git", ["ls-files", "-z", "--", DIST], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter((path) => path !== "");
    expect(listed).toEqual([BUNDLE]);
  });

  it("the dist directory on disk holds only the file a build makes", () => {
    const dir = join(ROOT, DIST);
    if (!existsSync(dir)) return;
    expect(readdirSync(dir, { recursive: true }).map(String).sort()).toEqual(["index.js"]);
  });
});
