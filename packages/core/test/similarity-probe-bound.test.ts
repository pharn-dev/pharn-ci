import { describe, expect, it } from "vitest";
import { MAX_SIMILARITY_PROBES, SimilarityIndex } from "../src/signals/bodyTokens.js";

// SimilarityIndex.find looks at no more than MAX_SIMILARITY_PROBES posting entries per lookup, skipped and rejected
// ones included (bodyTokens.ts). The linear-time tests of TI01/TI02 (ac-ti0102-linear) never reach the bound, so they
// pass with it removed (CORE-134). Here every head set holds the same tokens as the candidate, the adversarial case:
// each head is in every posting list the candidate probes, and each is skipped or rejected, so without the bound one
// lookup visits every head. The callbacks count the probes: `isSkipped` runs once per probed head, and `accept` once
// per probed head that is not skipped and passes the size and Jaccard checks.

const TOKENS = ["alpha", "beta", "gamma", "delta", "epsilon"];
const HEADS = 4 * 256;

function heads(count: number): Set<string>[] {
  return Array.from({ length: count }, () => new Set(TOKENS));
}

describe("SimilarityIndex: the probe bound", () => {
  it("the bound is 256 posting entries per lookup", () => {
    // Raising it raises the cost of every lookup in TI01 and TI02 matching; that is a decision, made here.
    expect(MAX_SIMILARITY_PROBES).toBe(256);
  });

  it("a lookup over 1,024 identical skipped heads probes 256 of them and reports that it stopped at the bound", () => {
    const candidate = new Set(TOKENS);
    const index = new SimilarityIndex(heads(HEADS), [candidate]);
    let probed = 0;
    const found = index.find(candidate, () => {
      probed++;
      return true;
    });
    expect(probed, "heads probed").toBe(MAX_SIMILARITY_PROBES);
    expect(found).toEqual({ index: -1, bounded: true });
  });

  it("a lookup over 1,024 identical heads that accept rejects probes 256 of them and reports the bound", () => {
    const candidate = new Set(TOKENS);
    const index = new SimilarityIndex(heads(HEADS), [candidate]);
    let skippedAsked = 0;
    let accepted = 0;
    const found = index.find(
      candidate,
      () => {
        skippedAsked++;
        return false;
      },
      Number.POSITIVE_INFINITY,
      () => {
        accepted++;
        return false;
      },
    );
    expect(skippedAsked, "heads probed").toBe(MAX_SIMILARITY_PROBES);
    expect(accepted, "heads offered to accept").toBe(MAX_SIMILARITY_PROBES);
    expect(found).toEqual({ index: -1, bounded: true });
  });

  it("a head past the bound is not found, and the lookup says a similar head may exist", () => {
    const candidate = new Set(TOKENS);
    const index = new SimilarityIndex(heads(HEADS), [candidate]);
    const found = index.find(
      candidate,
      () => false,
      Number.POSITIVE_INFINITY,
      (i) => i === MAX_SIMILARITY_PROBES,
    );
    expect(found).toEqual({ index: -1, bounded: true });
    // The last head within the bound is still found.
    expect(
      index.find(
        candidate,
        () => false,
        Number.POSITIVE_INFINITY,
        (i) => i === MAX_SIMILARITY_PROBES - 1,
      ),
    ).toEqual({ index: MAX_SIMILARITY_PROBES - 1, bounded: false });
  });

  it("control: a lookup over exactly 256 skipped heads probes all of them and is not bounded; 257 is", () => {
    const candidate = new Set(TOKENS);
    for (const [count, bounded] of [
      [MAX_SIMILARITY_PROBES, false],
      [MAX_SIMILARITY_PROBES + 1, true],
    ] as const) {
      let probed = 0;
      const found = new SimilarityIndex(heads(count), [candidate]).find(candidate, () => {
        probed++;
        return true;
      });
      expect(probed, `${count} heads: heads probed`).toBe(MAX_SIMILARITY_PROBES);
      expect(found, `${count} heads`).toEqual({ index: -1, bounded });
    }
  });
});
