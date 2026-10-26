import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Skylos nine, part 2: README.md keeps its vitest Skylos paragraph and adds a pytest 8 of 9 sentence linking
// docs/PRECISION.md, and CHANGELOG.md's Unreleased › Added list gains one line for it. Both are compared with their
// copies at the commit this increment starts from, read with git show. The documents are read inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Current main before this increment: the base for the "unchanged" checks. */
const BASE = "f1b252eb1183caff8699301c992bb8e4c81454a7";

const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const readBase = (path: string) => execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT, encoding: "utf8" });
const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** A `## ` section's lines after its exact heading line, up to the next `## ` heading. */
function h2Section(text: string, heading: string): string[] {
  const all = lines(text);
  const start = all.indexOf(heading);
  if (start === -1) throw new Error(`no "${heading}" heading`);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

/** The paragraphs (runs of non-blank lines) of a section, each as its lines. */
function paragraphs(section: string[]): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  for (const line of section) {
    if (line.trim() === "") {
      if (current.length > 0) out.push(current);
      current = [];
    } else current.push(line);
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** Whether `block` appears as consecutive lines of `all`. */
function containsBlock(all: string[], block: string[]): boolean {
  for (let i = 0; i + block.length <= all.length; i++) {
    if (block.every((line, j) => all[i + j] === line)) return true;
  }
  return false;
}

/** The bullets of the `### Added` list under `## [Unreleased]`, each joined with its continuation lines. */
function unreleasedAdded(text: string): string[] {
  const all = lines(text);
  const start = all.findIndex((line) => /^## \[Unreleased\]/.test(line));
  if (start < 0) throw new Error("CHANGELOG.md has no ## [Unreleased] section");
  const end = all.findIndex((line, i) => i > start && /^## \[/.test(line));
  const unreleased = all.slice(start + 1, end < 0 ? undefined : end);
  const added = unreleased.findIndex((line) => line.trim() === "### Added");
  if (added < 0) return [];
  const rest = unreleased.slice(added + 1);
  const stop = rest.findIndex((line) => line.startsWith("### ") || line.startsWith("## "));
  const out: string[] = [];
  for (const line of stop < 0 ? rest : rest.slice(0, stop)) {
    if (/^- /.test(line)) out.push(line.slice(2).trim());
    else if (/^\s+\S/.test(line) && out.length > 0) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out.map(normalize);
}

describe("README.md and CHANGELOG.md name the pytest Skylos result", () => {
  it("AC-12: the README keeps its catch **7 of 9** paragraph and adds a pytest **8 of 9** sentence linking docs/PRECISION.md with no new 2, 4 or 5 of 9, and the Unreleased › Added list holds one new line naming fixtures/skylos-nine-pytest, 8 of 9 and docs/PRECISION.md", () => {
    const now = h2Section(read("README.md"), "## Test integrity");
    const base = h2Section(readBase("README.md"), "## Test integrity");

    const skylos = paragraphs(base).filter((p) => p.join("\n").includes("catch **7 of 9**"));
    expect(skylos, "the base README holds one catch **7 of 9** paragraph").toHaveLength(1);
    expect(containsBlock(now, skylos[0] as string[]), "the Skylos paragraph is kept as it was").toBe(true);
    expect(normalize(now.join("\n")), "catch **7 of 9**").toContain("catch **7 of 9**");

    const baseLines = new Set(base);
    const added = now.filter((line) => !baseLines.has(line));
    const PRECISION_LINK = /\]\((?:\.\/)?docs\/PRECISION\.md(?:#[^)]*)?\)/;
    const pytest = paragraphs(added).filter((p) => {
      const text = normalize(p.join(" "));
      return /\bpytest\b/.test(text) && text.includes("**8 of 9**") && PRECISION_LINK.test(text);
    });
    expect(pytest.length, "a new sentence naming pytest and **8 of 9** linking docs/PRECISION.md").toBeGreaterThan(0);
    for (const figure of ["2 of 9", "4 of 9", "5 of 9"]) {
      expect(
        added.filter((line) => line.includes(figure)),
        `no new README text holds ${figure}`,
      ).toEqual([]);
    }

    const bulletsBase = new Set(unreleasedAdded(readBase("CHANGELOG.md")));
    const newBullets = unreleasedAdded(read("CHANGELOG.md")).filter((b) => !bulletsBase.has(b));
    const entries = newBullets.filter((b) => b.includes("fixtures/skylos-nine-pytest"));
    expect(entries, "one new Added line naming fixtures/skylos-nine-pytest").toHaveLength(1);
    expect(entries[0], "it names 8 of 9").toContain("8 of 9");
    expect(entries[0], "it names docs/PRECISION.md").toContain("docs/PRECISION.md");
  });
});
