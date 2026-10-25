import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// precision-corpus-freeze: the three committed corpus files under fixtures/corpus/ are pretty-printed JSON in one
// fixed shape. Each file is read inside the test body, so a missing file fails only its own test.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FILES = ["TanStack__query.json", "shadcn-ui__ui.json", "honojs__hono.json"];

const sortedKeys = (value: object) => Object.keys(value).sort();

describe("precision-corpus-freeze: corpus file shape", () => {
  for (const file of FILES) {
    it(`AC-1: fixtures/corpus/${file} is 2-space JSON with a trailing newline, in the corpus document shape`, () => {
      const text = readFileSync(`${ROOT}fixtures/corpus/${file}`, "utf8");
      const doc = JSON.parse(text);
      expect(text).toBe(`${JSON.stringify(doc, null, 2)}\n`);

      expect(typeof doc).toBe("object");
      expect(doc).not.toBeNull();
      expect(Array.isArray(doc)).toBe(false);
      expect(sortedKeys(doc)).toEqual(["defaultBranch", "excluded", "frozenAt", "monorepo", "prs", "repo"]);
      expect(doc.frozenAt).toBe("2026-10-25T00:00:00Z");
      expect(typeof doc.defaultBranch).toBe("string");
      expect(doc.defaultBranch.length).toBeGreaterThan(0);

      expect(typeof doc.excluded).toBe("object");
      expect(doc.excluded).not.toBeNull();
      expect(sortedKeys(doc.excluded)).toEqual(["bots", "releases"]);
      for (const count of [doc.excluded.bots, doc.excluded.releases]) {
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(0);
      }

      expect(Array.isArray(doc.prs)).toBe(true);
      expect(doc.prs).toHaveLength(200);
      for (const pr of doc.prs) {
        expect(typeof pr).toBe("object");
        expect(pr).not.toBeNull();
        expect(sortedKeys(pr)).toEqual(["baseSha", "headSha", "mergeCommitSha", "mergedAt", "number"]);
      }
    });
  }
});
