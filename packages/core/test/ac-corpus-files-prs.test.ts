import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// precision-corpus-freeze: every frozen PR in the three committed corpus files is well formed, merged strictly
// before the freeze instant, unique by number, and the list is in a total newest-first order.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FILES = ["TanStack__query.json", "shadcn-ui__ui.json", "honojs__hono.json"];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SHA = /^[0-9a-f]{40}$/;

type FrozenPr = { number: number; mergedAt: string; baseSha: string; headSha: string; mergeCommitSha: string };

describe("precision-corpus-freeze: frozen PR lists", () => {
  for (const file of FILES) {
    it(`AC-2: fixtures/corpus/${file} lists unique, well-formed PRs merged before the freeze, newest first`, () => {
      const doc = JSON.parse(readFileSync(`${ROOT}fixtures/corpus/${file}`, "utf8"));
      const prs = doc.prs as FrozenPr[];
      const frozenAt = Date.parse(doc.frozenAt);
      expect(Number.isNaN(frozenAt)).toBe(false);
      expect(prs.length).toBeGreaterThan(0);

      for (const pr of prs) {
        expect(Number.isInteger(pr.number), `number ${pr.number}`).toBe(true);
        expect(pr.number, `number ${pr.number}`).toBeGreaterThan(0);
        expect(pr.mergedAt, `#${pr.number} mergedAt`).toMatch(ISO_UTC);
        expect(Date.parse(pr.mergedAt), `#${pr.number} merged before the freeze`).toBeLessThan(frozenAt);
        expect(pr.baseSha, `#${pr.number} baseSha`).toMatch(SHA);
        expect(pr.headSha, `#${pr.number} headSha`).toMatch(SHA);
        expect(pr.mergeCommitSha, `#${pr.number} mergeCommitSha`).toMatch(SHA);
      }
      expect(new Set(prs.map((pr) => pr.number)).size).toBe(prs.length);

      for (let i = 1; i < prs.length; i += 1) {
        const a = prs[i - 1] as FrozenPr;
        const b = prs[i] as FrozenPr;
        const ta = Date.parse(a.mergedAt);
        const tb = Date.parse(b.mergedAt);
        const ordered = ta > tb || (ta === tb && a.number > b.number);
        expect(ordered, `#${a.number} (${a.mergedAt}) before #${b.number} (${b.mergedAt})`).toBe(true);
      }
    });
  }
});
