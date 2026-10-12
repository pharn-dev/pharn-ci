import { describe, expect, it } from "vitest";
import { parseCobertura } from "../src/coverage/cobertura.js";
import { parseCoverage } from "../src/coverage/index.js";
import { parseLcov } from "../src/coverage/lcov.js";
import { fixture } from "./helpers.js";

const toObject = (map: ReturnType<typeof parseLcov>) =>
  Object.fromEntries([...map].map(([path, hits]) => [path, Object.fromEntries(hits)]));

describe("parseLcov", () => {
  it("parses relative paths, ignoring non-DA records", () => {
    expect(toObject(parseLcov(fixture("lcov/relative.info")))).toEqual({
      "src/math.ts": { 1: 3, 3: 3, 4: 0, 5: 0, 10: 2 },
      "src/new.ts": { 1: 1, 2: 1 },
    });
  });

  it("strips the repo root from absolute paths and leaves outside paths absolute", () => {
    const map = parseLcov(fixture("lcov/absolute.info"), { repoRoot: "/home/runner/work/demo/demo" });
    expect(toObject(map)).toEqual({
      "src/math.ts": { 3: 1, 4: 1 },
      "src/new.ts": { 2: 0 },
      "/opt/elsewhere/vendor.ts": { 1: 1 },
    });
  });

  it("keeps absolute paths when no repo root is given", () => {
    expect([...parseLcov(fixture("lcov/absolute.info")).keys()]).toContain("/home/runner/work/demo/demo/src/math.ts");
  });

  it("normalizes Windows paths", () => {
    const map = parseLcov(fixture("lcov/windows.info"), { repoRoot: "C:\\a\\demo\\demo" });
    expect(toObject(map)).toEqual({ "src/math.ts": { 3: 1 }, "src/new.ts": { 1: 0 } });
  });

  it("merges repeated files, handles CRLF and checksums, skips malformed DA and orphan DA", () => {
    expect(toObject(parseLcov(fixture("lcov/merge-and-malformed.info")))).toEqual({
      "src/math.ts": { 3: 3, 4: 0, 5: 7 },
    });
  });

  it("returns an empty map for empty input", () => {
    expect(parseLcov("").size).toBe(0);
  });
});

describe("parseCoverage", () => {
  it("dispatches lcov", () => {
    expect(parseCoverage("SF:a.ts\nDA:1,1\nend_of_record\n", "lcov").get("a.ts")?.get(1)).toBe(1);
  });

  it("cobertura is a stub until M3", () => {
    expect(() => parseCobertura("<coverage/>")).toThrow("not implemented (M3)");
    expect(() => parseCoverage("<coverage/>", "cobertura")).toThrow("not implemented (M3)");
  });
});
