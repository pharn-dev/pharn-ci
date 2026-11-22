import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// pr-comment-logo-2 AC-4. logoMarkup() is loaded inside the test body: the AC tests are written before the build, so
// nothing the build changes may run while the file loads.

/**
 * The raw URL of the repository at one commit; the logo's path follows it. It named `main` until CORE-124 pinned the
 * logo to a 40-character commit SHA (`ac-logo-pinned.test.ts` asserts the shape).
 */
const RAW_AT_COMMIT = /^https:\/\/raw\.githubusercontent\.com\/pharn-dev\/pharn-ci\/[0-9a-f]{40}\//;
const REPO_ROOT = new URL("../../../", import.meta.url);

describe("logoMarkup(): the logo URL names a committed SVG", () => {
  it("AC-4: the path after the raw main URL is a file in the repository whose content starts with <svg", async () => {
    const { logoMarkup } = await import("../src/render/logo.js");
    const src = /\bsrc="([^"]*)"/.exec(logoMarkup())?.[1];
    expect(src, "the logo line has a src").toBeDefined();
    const prefix = RAW_AT_COMMIT.exec(src as string)?.[0];
    expect(prefix, src).toBeDefined();

    const path = (src as string).slice((prefix as string).length);
    expect(path).not.toBe("");
    const file = fileURLToPath(new URL(path, REPO_ROOT));
    expect(existsSync(file), path).toBe(true);
    expect(readFileSync(file, "utf8").startsWith("<svg"), path).toBe(true);
  });
});
