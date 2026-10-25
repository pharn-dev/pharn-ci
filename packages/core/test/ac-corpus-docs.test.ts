import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// precision-corpus-freeze: docs/PRECISION.md section 2 records the picked and rejected repositories, the freeze
// instant, the excluded counts (equal to the committed corpus files), the three reproducing commands and where the
// detector run lands. Read inside the test bodies.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REPOS = ["TanStack/query", "shadcn-ui/ui", "honojs/hono"];
const COMMANDS = [
  "node scripts/corpus-freeze.mjs --repo TanStack/query --frozen-at 2026-10-25T00:00:00Z --count 200 --out fixtures/corpus/TanStack__query.json --monorepo true",
  "node scripts/corpus-freeze.mjs --repo shadcn-ui/ui --frozen-at 2026-10-25T00:00:00Z --count 200 --out fixtures/corpus/shadcn-ui__ui.json --monorepo true",
  "node scripts/corpus-freeze.mjs --repo honojs/hono --frozen-at 2026-10-25T00:00:00Z --count 200 --out fixtures/corpus/honojs__hono.json --monorepo false",
];

const section = () => {
  const lines = readFileSync(`${ROOT}docs/PRECISION.md`, "utf8").split("\n");
  const start = lines.indexOf("## 2. Precision corpus");
  expect(start, "docs/PRECISION.md has a line `## 2. Precision corpus`").toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
};

describe("precision-corpus-freeze: docs/PRECISION.md section 2", () => {
  it("AC-9: section 2 names the picked and rejected repositories, the freeze instant, the commands and the follow-up", () => {
    const text = section().join("\n");
    for (const needle of [
      ...REPOS,
      "withastro/astro",
      "node:test",
      "2026-10-25T00:00:00Z",
      ...COMMANDS,
      "scripts/corpus-run.mjs",
      "v0.3.0",
    ]) {
      expect(text, `section 2 contains ${needle}`).toContain(needle);
    }
  });

  it("AC-9: section 2's table states each picked repository's excluded bot and release counts from its corpus file", () => {
    const lines = section();
    for (const repo of REPOS) {
      const doc = JSON.parse(readFileSync(`${ROOT}fixtures/corpus/${repo.replace("/", "__")}.json`, "utf8"));
      const row = lines.find((line) => line.trim().startsWith(`| \`${repo}\` |`));
      expect(row, `a table row for ${repo}`).toBeDefined();
      const cells = (row as string)
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell) => cell !== "");
      expect(cells.length, `${repo} row cells`).toBeGreaterThanOrEqual(3);
      expect(cells[cells.length - 2], `${repo} excluded bots`).toBe(String(doc.excluded.bots));
      expect(cells[cells.length - 1], `${repo} excluded releases`).toBe(String(doc.excluded.releases));
    }
  });
});
