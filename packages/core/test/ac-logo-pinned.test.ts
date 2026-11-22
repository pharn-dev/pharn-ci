import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { logoMarkup } from "../src/render/logo.js";

// CORE-124 (R5.7) part B. The logo followed `main`, so a change to the file on `main` changed the image in every
// comment ever posted, in every consumer's repository. It is now pinned to one commit.

const REPO_ROOT = new URL("../../../", import.meta.url);

describe("the PR comment logo is pinned to a commit (CORE-124)", () => {
  it("the logo URL holds a 40-character commit SHA, never a branch", () => {
    const src = /\bsrc="([^"]*)"/.exec(logoMarkup())?.[1] ?? "";
    expect(src).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/pharn-dev\/pharn-ci\/[0-9a-f]{40}\/docs\/assets\/pharn-logo\.svg$/,
    );
    expect(src).not.toContain("/main/");
  });

  it("docs/RELEASING.md says to update the SHA when the logo changes", () => {
    const releasing = readFileSync(new URL("docs/RELEASING.md", REPO_ROOT), "utf8");
    const line = releasing.split("\n").find((l) => l.includes("pharn-logo.svg")) ?? "";
    expect(line).toContain("packages/core/src/render/logo.ts");
    expect(line).toMatch(/SHA/);
  });
});
