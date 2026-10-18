import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// The merge module, the lcov parser and the fixtures are loaded inside the test body: the AC test is written before
// packages/core/src/coverage/merge.ts and fixtures/coverage-multi/ exist, so nothing that depends on them may run
// while the file loads.

type Map2 = Map<string, Map<number, number>>;

/** A coverage map as a plain object with sorted keys, so two maps compare equal whatever their insertion order. */
const toObject = (map: Map2) =>
  Object.fromEntries(
    [...map.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, hits]) => [path, Object.fromEntries([...hits.entries()].sort(([a], [b]) => a - b))]),
  );

describe("mergeCoverageMaps", () => {
  it("AC-2: unions the paths, sums the hits per line, and gives the same result in either order", async () => {
    const { mergeCoverageMaps } = (await import("../src/coverage/merge.js")) as {
      mergeCoverageMaps: (maps: readonly Map2[]) => Map2;
    };
    const { parseLcov } = await import("../src/coverage/lcov.js");
    const a = parseLcov(fixture("coverage-multi/merge-a.info"));
    const b = parseLcov(fixture("coverage-multi/merge-b.info"));

    // The fixtures are what the criterion describes: line 1 has 2 and 3 hits, line 2 has 0 and 4, line 3 has 0 and 0,
    // and each map has a file the other lacks.
    expect(a.get("src/shared.ts")?.get(1)).toBe(2);
    expect(b.get("src/shared.ts")?.get(1)).toBe(3);
    expect(a.has("src/only-a.ts") && !b.has("src/only-a.ts")).toBe(true);
    expect(b.has("src/only-b.ts") && !a.has("src/only-b.ts")).toBe(true);

    const merged = mergeCoverageMaps([a, b]);
    expect([...merged.keys()].sort()).toEqual(["src/only-a.ts", "src/only-b.ts", "src/shared.ts"]);
    const shared = merged.get("src/shared.ts");
    expect(shared?.get(1)).toBe(5);
    expect(shared?.get(2)).toBe(4);
    expect(shared?.get(3)).toBe(0);
    expect(toObject(merged)).toEqual({
      "src/only-a.ts": { 1: 1 },
      "src/only-b.ts": { 1: 0 },
      "src/shared.ts": { 1: 5, 2: 4, 3: 0 },
    });

    expect(toObject(mergeCoverageMaps([b, a]))).toEqual(toObject(merged));
  });
});
