import { describe, expect, it } from "vitest";

// cutCodeUnits is loaded inside the test body: it does not exist before the build, and a top-level import would keep
// the file's tests from being collected.

type Cut = (text: string, limit: number, options?: { marker?: boolean }) => string;

async function load(): Promise<Cut> {
  const { cutCodeUnits } = (await import("../src/text.js")) as unknown as { cutCodeUnits: Cut };
  return cutCodeUnits;
}

describe("text helpers: the shared cut", () => {
  it('AC-2: with limit 4 the marker cut gives "ab…" for "ab😀cd" and "abc…" for "abcdef", and the cut without the marker gives "ab😀" for "ab😀cd"', async () => {
    const cutCodeUnits = await load();
    expect(cutCodeUnits("ab😀cd", 4), "the marker is on by default and never splits the pair").toBe("ab…");
    expect(cutCodeUnits("abcdef", 4), "the … is inside the limit").toBe("abc…");
    expect(cutCodeUnits("ab😀cd", 4, { marker: true }), "an explicit marker").toBe("ab…");
    expect(cutCodeUnits("ab😀cd", 4, { marker: false }), "no marker keeps the whole pair").toBe("ab😀");
  }, 120_000);
});
