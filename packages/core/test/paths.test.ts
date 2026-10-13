import { describe, expect, it } from "vitest";
import { foldForRoot, isAbsolutePath, normalizePath, normalizeRoot, startsWithPath } from "../src/paths.js";

describe("isAbsolutePath", () => {
  it.each(["/a", "\\a", "C:\\a", "c:/a"])("treats %s as absolute", (input) => {
    expect(isAbsolutePath(input)).toBe(true);
  });

  it.each(["a", "./a", "C:a", "", "src/a.ts"])("treats %j as relative", (input) => {
    expect(isAbsolutePath(input)).toBe(false);
  });
});

describe("normalizePath", () => {
  it.each([
    ["src/a.ts", "src/a.ts"],
    ["./src/a.ts", "src/a.ts"],
    ["src//lib/./a.ts", "src/lib/a.ts"],
    ["src/lib/../a.ts", "src/a.ts"],
    ["../outside/a.ts", "../outside/a.ts"],
    ["src\\lib\\a.ts", "src/lib/a.ts"],
    ["/abs/../../a.ts", "/a.ts"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it("strips the repo root from absolute paths", () => {
    expect(normalizePath("/home/runner/work/r/r/src/a.ts", "/home/runner/work/r/r")).toBe("src/a.ts");
    expect(normalizePath("/home/runner/work/r/r/src/a.ts", "/home/runner/work/r/r/")).toBe("src/a.ts");
    expect(normalizePath("/home/runner/work/r/r/./src/x/../a.ts", "/home/runner/work/r/r")).toBe("src/a.ts");
  });

  it("does not strip a root that is only a string prefix", () => {
    expect(normalizePath("/repo-other/src/a.ts", "/repo")).toBe("/repo-other/src/a.ts");
  });

  it("keeps absolute paths outside the root absolute", () => {
    expect(normalizePath("/opt/vendor/a.ts", "/repo")).toBe("/opt/vendor/a.ts");
  });

  it("handles Windows drive paths case-insensitively", () => {
    expect(normalizePath("c:\\a\\repo\\src\\a.ts", "C:\\a\\repo")).toBe("src/a.ts");
    expect(normalizePath("C:\\a\\Repo\\src\\a.ts", "c:/a/repo")).toBe("src/a.ts");
  });
});

describe("paths: hostile input", () => {
  // Generous: CI runners vary, and a quadratic scan of a million characters would take minutes.
  const LIMIT_MS = 2000;

  it("handles a million slashes and backslashes in roots and paths in linear time", () => {
    const slashes = "/".repeat(1_000_000);
    const mixed = "/\\".repeat(250_000);
    const started = performance.now();
    expect(normalizeRoot(slashes)).toBe("");
    expect(normalizeRoot(`C:${mixed}a${mixed}`)).toBe("C:/a");
    expect(normalizePath(`/a/${mixed}b${mixed}`, `/a${mixed}`)).toBe("b");
    expect(startsWithPath(slashes, "/a")).toBe(false);
    expect(foldForRoot(slashes, "C:/a")).toBe(slashes);
    expect(performance.now() - started).toBeLessThan(LIMIT_MS);
  }, 30_000);
});
