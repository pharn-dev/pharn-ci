import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// docs/MARKETPLACE.md, docs/RELEASING.md and action.yml are read inside each test body, so a missing doc is a
// failed test, not a file that fails to load.

const repoFile = (path: string) => new URL(`../../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(repoFile(path), "utf8").replace(/\r\n/g, "\n");

/** The lines under the exact `## <heading>` line, up to the next `## ` heading. */
const section = (markdown: string, heading: string): string[] => {
  const lines = markdown.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  expect(start, `section "## ${heading}"`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
};

const firstNonBlank = (lines: string[]) => (lines.find((line) => line.trim() !== "") ?? "").trim();

/** A top-level scalar of action.yml, unquoted. */
const actionField = (actionYml: string, key: string): string => {
  const match = actionYml.match(new RegExp(`^${key}:[ \\t]*(.+)$`, "m"));
  expect(match, `action.yml top-level ${key}`).not.toBeNull();
  return (match?.[1] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
};

/** The input names declared under action.yml `inputs:` (two-space-indented keys before the next top-level key). */
const actionInputs = (actionYml: string): string[] => {
  const lines = actionYml.split("\n");
  const start = lines.findIndex((line) => /^inputs:\s*$/.test(line));
  expect(start, "action.yml inputs:").toBeGreaterThanOrEqual(0);
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (match?.[1]) names.push(match[1]);
  }
  return names;
};

const indentOf = (line: string) => line.length - line.trimStart().length;

const CATEGORIES = ["Code quality", "Code review", "Continuous integration", "Security", "Testing", "Utilities"];

describe("release readiness: docs/MARKETPLACE.md listing", () => {
  it("AC-4: name, one-line description, three-paragraph description and two categories match action.yml", () => {
    const listing = read("docs/MARKETPLACE.md");
    const actionYml = read("action.yml");

    expect(firstNonBlank(section(listing, "Name")), "name").toBe(actionField(actionYml, "name"));

    const oneLine = firstNonBlank(section(listing, "One-line description"));
    expect(oneLine.length, "one-line description length").toBeLessThanOrEqual(125);
    expect(oneLine, "one-line description").toBe(actionField(actionYml, "description"));

    const paragraphs = section(listing, "Description")
      .join("\n")
      .trim()
      .split(/\n[ \t]*\n/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph !== "");
    expect(paragraphs, "description paragraphs").toHaveLength(3);

    const categories = section(listing, "Categories").join("\n");
    const primary = categories.match(/^- Primary:[ \t]*(.+)$/m)?.[1]?.trim();
    const secondary = categories.match(/^- Secondary:[ \t]*(.+)$/m)?.[1]?.trim();
    expect(CATEGORIES, "primary category").toContain(primary);
    expect(CATEGORIES, "secondary category").toContain(secondary);
    expect(primary, "primary and secondary differ").not.toBe(secondary);
  });

  it("AC-5: the quick start uses pharn-dev/pharn-ci@v<VERSION> with only inputs action.yml declares", async () => {
    const { VERSION } = await import("../src/version.js");
    const listing = read("docs/MARKETPLACE.md");
    const inputs = actionInputs(read("action.yml"));

    const lines = listing.split("\n");
    const start = lines.indexOf("## Quick start");
    expect(start, 'section "## Quick start"').toBeGreaterThanOrEqual(0);
    const open = lines.findIndex((line, i) => i > start && /^\s*```yaml\s*$/.test(line));
    expect(open, "a ```yaml block in the quick start").toBeGreaterThan(start);
    const close = lines.findIndex((line, i) => i > open && /^\s*```\s*$/.test(line));
    expect(close, "the ```yaml block closes").toBeGreaterThan(open);
    const yaml = lines.slice(open + 1, close);

    const usesAt = yaml.findIndex((line) => /^\s*(- )?uses:\s*pharn-dev\/pharn-ci@/.test(line));
    expect(usesAt, "a step that uses pharn-dev/pharn-ci").toBeGreaterThanOrEqual(0);
    const usesLine = yaml[usesAt] ?? "";
    expect(usesLine.trim().replace(/^- /, ""), "the step's uses:").toBe(`uses: pharn-dev/pharn-ci@v${VERSION}`);

    // The step's keys sit at the column of `uses`; the step ends at the first line indented less.
    const keyIndent = indentOf(usesLine) + (usesLine.trimStart().startsWith("- ") ? 2 : 0);
    const withKeys: string[] = [];
    let inWith = false;
    let foundWith = false;
    for (const line of yaml.slice(usesAt + 1)) {
      if (line.trim() === "" || line.trim().startsWith("#")) continue;
      const indent = indentOf(line);
      if (indent < keyIndent) break;
      if (indent === keyIndent) {
        inWith = /^\s*with:\s*$/.test(line);
        foundWith ||= inWith;
        continue;
      }
      if (inWith) {
        const key = line.match(/^\s*([A-Za-z0-9_-]+):/)?.[1];
        if (key && indent > keyIndent) withKeys.push(key);
      }
    }
    expect(foundWith, "the step has a with: block").toBe(true);
    expect(withKeys.length, "inputs set under with:").toBeGreaterThanOrEqual(1);
    for (const key of withKeys) {
      expect(inputs, `with: ${key} is an action.yml input`).toContain(key);
    }
  });
});

describe("release readiness: docs/RELEASING.md", () => {
  it("AC-6: the version step names all five version files and the placeholder date is replaced first", () => {
    const releasing = read("docs/RELEASING.md");
    const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

    // List items of "## Cutting a release": an item starts at a `-`, `*` or `1.` marker and runs until the next one.
    const items: string[] = [];
    for (const line of section(releasing, "Cutting a release")) {
      const marker = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
      if (marker) items.push(marker[1] ?? "");
      else if (line.trim() !== "" && items.length > 0) items[items.length - 1] += ` ${line.trim()}`;
    }
    const versionStep = items.map(normalize).find((item) => item.startsWith('Set `"version": "X.Y.Z"`'));
    expect(versionStep, 'the list item beginning Set `"version": "X.Y.Z"`').toBeDefined();
    for (const name of [
      "root `package.json`",
      "packages/core/package.json",
      "packages/cli/package.json",
      "packages/action/package.json",
      "packages/core/src/version.ts",
    ]) {
      expect(versionStep, `the version step names ${name}`).toContain(name);
    }

    const sentences = normalize(releasing)
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.toLowerCase());
    const needles = ["replaces the `yyyy-mm-dd` placeholder", "release date", "before running the release workflow"];
    expect(
      sentences.some((sentence) => needles.every((needle) => sentence.includes(needle))),
      `one sentence says: ${needles.join(" / ")}`,
    ).toBe(true);
  });
});
