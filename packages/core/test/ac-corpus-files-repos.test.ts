import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// precision-corpus-freeze: each corpus file names its own repository, the monorepo classification is the
// maintainer's, and no PR content (titles, bodies, authors) reaches a committed file.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EXPECTED: Record<string, { repo: string; monorepo: boolean }> = {
  "TanStack__query.json": { repo: "TanStack/query", monorepo: true },
  "shadcn-ui__ui.json": { repo: "shadcn-ui/ui", monorepo: true },
  "honojs__hono.json": { repo: "honojs/hono", monorepo: false },
};
const FORBIDDEN_KEYS = ['"title"', '"body"', '"user"', '"login"'];

describe("precision-corpus-freeze: corpus repositories", () => {
  it("AC-3: each file's repo is its file name with __ as /, the repos are distinct, and the monorepo flags are as classified", () => {
    const repos: string[] = [];
    const monorepos: boolean[] = [];
    for (const [file, expected] of Object.entries(EXPECTED)) {
      const doc = JSON.parse(readFileSync(`${ROOT}fixtures/corpus/${file}`, "utf8"));
      const fromName = file.replace(/\.json$/, "").replace("__", "/");
      expect(doc.repo, file).toBe(fromName);
      expect(doc.repo, file).toBe(expected.repo);
      expect(doc.monorepo, file).toBe(expected.monorepo);
      repos.push(doc.repo);
      monorepos.push(doc.monorepo);
    }
    expect(new Set(repos).size).toBe(3);
    expect(monorepos.some((value) => value === true)).toBe(true);
  });

  it("AC-3: no corpus file's text contains a title, body, user or login key", () => {
    for (const file of Object.keys(EXPECTED)) {
      const text = readFileSync(`${ROOT}fixtures/corpus/${file}`, "utf8");
      for (const key of FORBIDDEN_KEYS) {
        expect(text.includes(key), `${file} contains ${key}`).toBe(false);
      }
    }
  });
});
