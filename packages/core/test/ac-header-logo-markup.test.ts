import { describe, expect, it } from "vitest";

// pr-comment-logo-2 AC-1. logoMarkup() is loaded inside the test body: the AC tests are written before the build, so
// nothing the build changes may run while the file loads.

/** The one fixed logo line, written here so the test does not reuse the renderer's own constant. */
const LOGO =
  '<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">';

describe("logoMarkup(): the fixed pharn logo line", () => {
  it("AC-1: returns exactly the fixed <img> line for the pharn logo on the raw main URL", async () => {
    const { logoMarkup } = await import("../src/render/logo.js");
    expect(logoMarkup()).toBe(LOGO);
    // Fixed: every call returns the same string.
    expect(logoMarkup()).toBe(logoMarkup());
  });
});
