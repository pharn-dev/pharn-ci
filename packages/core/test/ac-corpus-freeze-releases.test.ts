import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// precision-corpus-freeze: the changesets release classifier of scripts/corpus-freeze.mjs over the recorded REST
// pull objects in fixtures/corpus-freeze/classify.json. Loaded inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = pathToFileURL(`${ROOT}scripts/corpus-freeze.mjs`).href;

type Pull = { number: number; title: string; head: { ref: string } };

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("precision-corpus-freeze: isRelease", () => {
  it("AC-5: isRelease is true exactly for changeset-release/ heads and whole 'version packages' titles", async () => {
    const { isRelease } = await import(SCRIPT);
    const pulls = JSON.parse(readFileSync(`${ROOT}fixtures/corpus-freeze/classify.json`, "utf8")) as Pull[];

    const heads = pulls.map((pull) => pull.head.ref);
    const titles = pulls.map((pull) => pull.title);
    expect(heads).toContain("changeset-release/main");
    expect(heads).toContain("changeset-release/next");
    for (const title of [
      "Version Packages",
      "chore: version packages",
      "chore(release): Version Packages",
      "VERSION PACKAGES",
      "docs: explain version packages",
      "Version packages for docs",
      "fix: version check",
    ]) {
      expect(titles, `fixture holds the title ${title}`).toContain(title);
    }

    // A whole title of "version packages", case-insensitively, after an optional conventional-commit prefix
    // such as `chore:` or `chore(release):`.
    const byRule = (pull: Pull) =>
      pull.head.ref.startsWith("changeset-release/") ||
      /^(?:[a-z]+(?:\([^)]*\))?!?:\s*)?version packages$/.test(pull.title.trim().toLowerCase());
    for (const pull of pulls) {
      expect(isRelease(pull), `#${pull.number} (${pull.head.ref}, ${pull.title})`).toBe(byRule(pull));
    }

    const numbers = new Set(pulls.map((pull) => pull.number));
    const result = (n: number) => isRelease(pulls.find((pull) => pull.number === n));
    for (const n of range(120, 125)) {
      expect(numbers.has(n), `fixture holds #${n}`).toBe(true);
      expect(result(n), `#${n} is a release`).toBe(true);
    }
    for (const n of [...range(101, 112), ...range(126, 129)]) {
      expect(numbers.has(n), `fixture holds #${n}`).toBe(true);
      expect(result(n), `#${n} is not a release`).toBe(false);
    }
  });
});
