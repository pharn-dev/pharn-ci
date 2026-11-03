import { describe, expect, it, vi } from "vitest";

// The Action loads the TypeScript parser lazily, on the first read of a `ts` property (packages/action/src/
// vendored-typescript.ts). A failure to load throws from that read. For the Action to fail the step instead of switching
// the test index off, the first read of a parse must sit OUTSIDE the `try` that turns a parser throw into a refusal.
// The stand-in below throws a marker error from every TypeScript member core reads.

const MARKER = new Error("typescript5 could not be loaded");

vi.mock("typescript5", () => ({
  default: new Proxy(
    {},
    {
      get: (_target, property) => {
        if (typeof property === "string") throw MARKER;
        return undefined;
      },
    },
  ),
}));

const { parseTestFile } = await import("../src/testIndex/parse.js");
const { indexTestFile } = await import("../src/testIndex/indexTestFile.js");
const { readJs } = await import("../src/testConfig/readJs.js");

const KINDS = ["ts", "tsx", "js", "jsx"] as const;
const PATHS = ["a.test.ts", "a.test.tsx", "a.test.js", "a.test.jsx"];

describe("a typescript5 that cannot be loaded is thrown, never refused", () => {
  it.each(KINDS)("parseTestFile throws the load error for %s", (kind) => {
    expect(() => parseTestFile(kind, "export {};")).toThrow(MARKER);
  });

  it.each(PATHS)("indexTestFile throws the load error for %s", (path) => {
    expect(() => indexTestFile(path, 'it("x", () => {});')).toThrow(MARKER);
  });

  it.each(["vitest.config.ts", "vitest.config.js", "jest.config.js"])("readJs throws the load error for %s", (path) => {
    expect(() => readJs(path, "export default {};")).toThrow(MARKER);
  });

  it("importing the parser modules reads nothing from typescript5", () => {
    // The dynamic imports above ran at module evaluation; had any module read a property then, this file would not load.
    expect(typeof parseTestFile).toBe("function");
  });
});
