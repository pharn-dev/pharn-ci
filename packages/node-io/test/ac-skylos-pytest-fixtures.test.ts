import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Skylos nine, part 2: the shape of fixtures/skylos-nine-pytest/. The case directories are written by the build, so
// they are listed and read inside the test body (a missing directory fails only this test), and core's diff parser and
// source-path selector are loaded inside the body too. Nothing here is read from a fixture's name but the case list.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const CASES_DIR = `${FIXTURES}skylos-nine-pytest/`;

const CASES = [
  "added-skip",
  "added-skip-aliased",
  "always-true-matcher",
  "always-true-matcher-any",
  "deleted-test",
  "deselect-setting",
  "edited-expected-value",
  "emptied-assertion",
  "hard-coded-answer",
  "loosened-assertion",
  "replaced-test",
];

/** The logical paths of the `<logical path>.txt` files under one side of a case, sorted; none when it is absent. */
function sidePaths(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => name.slice(0, -".txt".length))
    .sort();
}

const sorted = (values: Iterable<string>) => [...values].sort();

describe("Skylos nine for pytest: the fixture directory", () => {
  it("AC-1: fixtures/skylos-nine-pytest/ holds exactly the eleven case directories, each with change.diff, files.txt and only optional base/ and head/, every diff parses and touches only .py or pyproject.toml, every files.txt lists the head side and no deleted path, and each side's .txt set equals selectTestSourcePaths", async () => {
    const { parseUnifiedDiff, selectTestSourcePaths } = await import("@pharn-ci/core");

    const entries = readdirSync(CASES_DIR, { withFileTypes: true });
    expect(
      entries.filter((e) => !e.isDirectory()).map((e) => e.name),
      "no entry but the case directories",
    ).toEqual([]);
    expect(sorted(entries.map((e) => e.name)), "exactly the eleven case directories").toEqual(CASES);

    for (const name of CASES) {
      const root = `${CASES_DIR}${name}/`;
      const inside = readdirSync(root, { withFileTypes: true });
      const files = sorted(inside.filter((e) => e.isFile()).map((e) => e.name));
      const dirs = sorted(inside.filter((e) => e.isDirectory()).map((e) => e.name));
      expect(files, `${name}: its files`).toEqual(["change.diff", "files.txt"]);
      expect(
        inside.filter((e) => !e.isFile() && !e.isDirectory()).map((e) => e.name),
        `${name}: no other entry kind`,
      ).toEqual([]);
      for (const dir of dirs) expect(["base", "head"], `${name}: directory ${dir}`).toContain(dir);

      const diffText = readFileSync(`${root}change.diff`, "utf8");
      expect(diffText.trim().length, `${name}: change.diff is not empty`).toBeGreaterThan(0);
      const diff = parseUnifiedDiff(diffText);
      expect(diff.length, `${name}: change.diff parses into at least one file`).toBeGreaterThan(0);
      for (const file of diff) {
        for (const path of new Set([file.path, file.oldPath])) {
          expect(path === "pyproject.toml" || path.endsWith(".py"), `${name}: touched path ${path}`).toBe(true);
        }
      }

      const listText = readFileSync(`${root}files.txt`, "utf8");
      const listed = listText.replace(/\n$/, "").split("\n");
      expect(listText.trim().length, `${name}: files.txt is not empty`).toBeGreaterThan(0);
      for (const path of listed) {
        expect(path, `${name}: files.txt line ${JSON.stringify(path)} is a path`).toMatch(/^[^\s/\\][^\s\\]*$/);
        expect(path.split("/"), `${name}: ${path} is repository-relative`).not.toContain("..");
        expect(path.split("/"), `${name}: ${path} has no empty segment`).not.toContain("");
      }

      const picked = selectTestSourcePaths(diff);
      const base = sidePaths(`${root}base`);
      const head = sidePaths(`${root}head`);
      expect(base, `${name}: base/ holds exactly the picked base paths`).toEqual(sorted(picked.base));
      expect(head, `${name}: head/ holds exactly the picked head paths`).toEqual(sorted(picked.head));

      for (const path of head) expect(listed, `${name}: files.txt lists head path ${path}`).toContain(path);
      for (const file of diff.filter((f) => f.status === "deleted")) {
        expect(listed, `${name}: files.txt does not list deleted ${file.path}`).not.toContain(file.path);
      }
    }
  });
});
