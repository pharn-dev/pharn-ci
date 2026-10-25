import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";

// Skylos nine: the shape of fixtures/skylos-nine/. The fixtures are inputs only, small, hand-written and
// vitest-flavoured. The directory is listed and read inside each test body: the AC tests are written before it exists,
// so a missing fixture fails only its test, never the file's load.

const CASES = [
  "deleted-test",
  "added-skip",
  "emptied-assertion",
  "deselect-setting",
  "hard-coded-answer",
  "always-true-matcher",
  "replaced-test",
  "loosened-assertion",
  "edited-expected-value",
];

const SOURCE_EXTENSION = /\.(ts|tsx|js|mjs)$/;

interface FileDiff {
  /** Every path the file's headers name: both sides of `diff --git`, and `---` / `+++` unless `/dev/null`. */
  paths: string[];
  /** The hunks, each starting with its `@@` line. */
  hunks: string[][];
}

/** Split a unified diff into its files; every line after a file's first `@@` belongs to a hunk. */
function parseDiff(text: string): FileDiff[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const files: FileDiff[] = [];
  let current: FileDiff | undefined;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
      if (match === null) throw new Error(`unreadable file header: ${line}`);
      current = { paths: [match[1] as string, match[2] as string], hunks: [] };
      files.push(current);
      continue;
    }
    if (current === undefined) throw new Error(`a line before the first file header: ${line}`);
    const hunk = current.hunks.at(-1);
    if (line.startsWith("@@")) current.hunks.push([line]);
    else if (hunk !== undefined) hunk.push(line);
    else if (/^(---|\+\+\+) /.test(line) && !line.endsWith("/dev/null")) current.paths.push(line.slice(6));
  }
  return files;
}

describe("Skylos nine: the fixture directory", () => {
  it("AC-5: fixtures/skylos-nine holds exactly the nine case directories, each with exactly change.diff and files.txt", () => {
    const root = `${FIXTURES}skylos-nine`;
    const entries = readdirSync(root, { withFileTypes: true });
    expect(entries.every((entry) => entry.isDirectory())).toBe(true);
    expect(entries.map((entry) => entry.name).sort()).toEqual([...CASES].sort());
    for (const name of CASES) {
      const files = readdirSync(`${root}/${name}`, { withFileTypes: true });
      expect(files.map((file) => `${file.isFile() ? "file" : "other"}:${file.name}`).sort(), name).toEqual([
        "file:change.diff",
        "file:files.txt",
      ]);
    }
  });

  it("AC-5: every change.diff is a non-empty unified diff with no context lines that touches only .ts, .tsx, .js or .mjs paths", () => {
    for (const name of CASES) {
      const text = fixture(`skylos-nine/${name}/change.diff`);
      expect(text.trim().length, name).toBeGreaterThan(0);
      const files = parseDiff(text);
      expect(files.length, name).toBeGreaterThan(0);
      for (const file of files) {
        expect(file.hunks.length, `${name}: ${file.paths[0]}`).toBeGreaterThan(0);
        for (const hunk of file.hunks) {
          expect(hunk[0], name).toMatch(/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/);
          for (const line of hunk) expect(line, `${name}: hunk line`).toMatch(/^(@@|\+|-)/);
        }
        for (const path of file.paths) expect(path, name).toMatch(SOURCE_EXTENSION);
      }
    }
  });

  it("AC-5: no change.diff or files.txt holds pytest or a .py path", () => {
    for (const name of CASES) {
      for (const file of ["change.diff", "files.txt"]) {
        const text = fixture(`skylos-nine/${name}/${file}`);
        expect(text, `${name}/${file}`).not.toContain("pytest");
        expect(text, `${name}/${file}`).not.toMatch(/\.py\b/);
      }
    }
  });

  it("AC-5: every files.txt is non-empty with one repository-relative path per line", () => {
    for (const name of CASES) {
      const text = fixture(`skylos-nine/${name}/files.txt`);
      expect(text.trim().length, name).toBeGreaterThan(0);
      const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
      for (const line of lines) {
        expect(line, name).toMatch(/^[^\s/\\][^\s\\]*$/);
        expect(line.split("/"), `${name}: ${line}`).not.toContain("..");
        expect(line.split("/"), `${name}: ${line}`).not.toContain(".");
        expect(line.split("/"), `${name}: ${line}`).not.toContain("");
      }
    }
  });
});
