import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// precision-corpus-freeze: the document builder of scripts/corpus-freeze.mjs over the recorded REST pull objects in
// fixtures/corpus-freeze/window.json, with a freeze instant of 2026-06-01T00:00:00Z and a count of 3. Loaded
// inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = pathToFileURL(`${ROOT}scripts/corpus-freeze.mjs`).href;
const FROZEN_AT = "2026-06-01T00:00:00Z";

type Pull = {
  number: number;
  merged_at: string | null;
  merge_commit_sha: string;
  base: { sha: string };
  head: { sha: string };
};

describe("precision-corpus-freeze: buildDocument", () => {
  it("AC-6: buildDocument keeps the newest qualifying PRs before the freeze and counts exclusions in the kept window", async () => {
    const { buildDocument } = await import(SCRIPT);
    const pulls = JSON.parse(readFileSync(`${ROOT}fixtures/corpus-freeze/window.json`, "utf8")) as Pull[];

    // The fixture carries the cases the criterion names.
    expect(pulls.some((pull) => pull.merged_at === null)).toBe(true);
    expect(pulls.some((pull) => pull.merged_at === FROZEN_AT)).toBe(true);
    expect(pulls.some((pull) => pull.merged_at !== null && Date.parse(pull.merged_at) > Date.parse(FROZEN_AT))).toBe(
      true,
    );
    const mergeTimes = new Map<string, Set<number>>();
    for (const pull of pulls) {
      if (pull.merged_at === null) continue;
      const set = mergeTimes.get(pull.merged_at) ?? new Set<number>();
      set.add(pull.number);
      mergeTimes.set(pull.merged_at, set);
    }
    expect([...mergeTimes.values()].some((set) => set.size >= 2)).toBe(true);
    expect(pulls.filter((pull) => pull.number === 204)).toHaveLength(2);
    expect(pulls.filter((pull) => pull.number === 205)).toHaveLength(2);

    const input = structuredClone(pulls);
    const doc = buildDocument(
      { repo: "example/repo", defaultBranch: "main", monorepo: false, frozenAt: FROZEN_AT, count: 3 },
      input,
    );

    const frozen = (n: number) => {
      const pull = pulls.find((candidate) => candidate.number === n) as Pull;
      return {
        number: n,
        mergedAt: pull.merged_at,
        baseSha: pull.base.sha,
        headSha: pull.head.sha,
        mergeCommitSha: pull.merge_commit_sha,
      };
    };
    expect(doc).toStrictEqual({
      repo: "example/repo",
      defaultBranch: "main",
      monorepo: false,
      frozenAt: FROZEN_AT,
      excluded: { bots: 3, releases: 1 },
      prs: [frozen(204), frozen(207), frozen(206)],
    });
  });
});
