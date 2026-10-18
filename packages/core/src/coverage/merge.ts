import type { CoverageMap } from "./types.js";

/**
 * Merge coverage maps from several files: the union of the paths (first-seen order), with the hit counts
 * of a line that several maps list summed. Summing is commutative, so the order of the maps does not change
 * the result. The inputs are not changed.
 */
export function mergeCoverageMaps(maps: readonly CoverageMap[]): CoverageMap {
  const merged: CoverageMap = new Map();
  for (const map of maps) {
    for (const [path, lines] of map) {
      let target = merged.get(path);
      if (target === undefined) {
        target = new Map();
        merged.set(path, target);
      }
      for (const [line, hits] of lines) target.set(line, (target.get(line) ?? 0) + hits);
    }
  }
  return merged;
}
