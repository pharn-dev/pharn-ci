import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// pr-comment-logo-2 AC-4. logoMarkup() is loaded inside the test body: the AC tests are written before the build, so
// nothing the build changes may run while the file loads.

/** The raw URL of the repository's main branch; the logo's path follows it. */
const RAW_MAIN = "https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/";
const REPO_ROOT = new URL("../../../", import.meta.url);

describe("logoMarkup(): the logo URL names a committed SVG", () => {
  it("AC-4: the path after the raw main URL is a file in the repository whose content starts with <svg", async () => {
    const { logoMarkup } = await import("../src/render/logo.js");
    const src = /\bsrc="([^"]*)"/.exec(logoMarkup())?.[1];
    expect(src, "the logo line has a src").toBeDefined();
    expect(src?.startsWith(RAW_MAIN), src).toBe(true);

    const path = (src as string).slice(RAW_MAIN.length);
    expect(path).not.toBe("");
    const file = fileURLToPath(new URL(path, REPO_ROOT));
    expect(existsSync(file), path).toBe(true);
    expect(readFileSync(file, "utf8").startsWith("<svg"), path).toBe(true);
  });
});
