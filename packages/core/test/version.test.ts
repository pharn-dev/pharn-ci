import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

describe("VERSION", () => {
  it.each(["core", "cli", "action", "node-io"])("matches packages/%s/package.json", (pkg) => {
    const json = JSON.parse(readFileSync(new URL(`../../${pkg}/package.json`, import.meta.url), "utf8"));
    expect(json.version).toBe(VERSION);
  });

  it("matches the root package.json", () => {
    const json = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
    expect(json).toHaveProperty("version");
    expect(json.version).toBe(VERSION);
  });
});
