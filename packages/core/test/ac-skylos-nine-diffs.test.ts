import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// Skylos nine: each of the seven miss cases' diffs actually shows its cheat, so a miss is a miss of the cheat and not
// of an empty or unrelated fixture. The fixtures and the product's test-file classifier are loaded inside each test
// body: the AC tests are written before fixtures/skylos-nine/ exists, so a missing fixture fails only its test.

interface FileDiff {
  /** The path at head, or at base for a deleted file. */
  path: string;
  status: "added" | "deleted" | "modified";
  removed: string[];
  added: string[];
}

/** Split a unified diff into its files with the lines each removes and adds. */
function parseDiff(text: string): FileDiff[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const files: FileDiff[] = [];
  let current: FileDiff | undefined;
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
      if (match === null) throw new Error(`unreadable file header: ${line}`);
      current = { path: match[2] as string, status: "modified", removed: [], added: [] };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (current === undefined) throw new Error(`a line before the first file header: ${line}`);
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      if (line.startsWith("new file mode")) current.status = "added";
      if (line.startsWith("deleted file mode")) current.status = "deleted";
      continue;
    }
    if (line.startsWith("+")) current.added.push(line.slice(1));
    else if (line.startsWith("-")) current.removed.push(line.slice(1));
  }
  return files;
}

const read = (name: string) => parseDiff(fixture(`skylos-nine/${name}/change.diff`));
const allRemoved = (files: FileDiff[]) => files.flatMap((f) => f.removed);
const allAdded = (files: FileDiff[]) => files.flatMap((f) => f.added);

async function isTestFile(path: string): Promise<boolean> {
  const { isTestFile: classify } = await import("../src/testFiles.js");
  return classify(path);
}

/** `it("name", …` or `test("name", …`: the test name. */
const OPENING = /^\s*(?:it|test)\(\s*(['"`])(.*?)\1/;

/** `.matcher(expected)` at the end of an assertion line: the matcher and its argument text. */
const MATCHER = /\.(to\w+)\((.*)\)\s*;?\s*$/;

describe("Skylos nine: each miss case's diff shows its cheat", () => {
  it("AC-6: emptied-assertion removes an expect( line from a test file and adds none", async () => {
    const files = read("emptied-assertion");
    const fromTests: string[] = [];
    for (const file of files) if (await isTestFile(file.path)) fromTests.push(...file.removed);
    expect(fromTests.some((line) => line.includes("expect("))).toBe(true);
    expect(allAdded(files).filter((line) => line.includes("expect("))).toEqual([]);
  });

  it("AC-6: deselect-setting touches only vitest.config.ts and changes an include or exclude line", () => {
    const files = read("deselect-setting");
    expect(files.map((f) => f.path)).toEqual(["vitest.config.ts"]);
    const changed = [...allRemoved(files), ...allAdded(files)];
    expect(changed.some((line) => line.includes("include") || line.includes("exclude"))).toBe(true);
  });

  it("AC-6: hard-coded-answer touches only files that are not test files and adds an if", async () => {
    const files = read("hard-coded-answer");
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(await isTestFile(file.path), file.path).toBe(false);
    expect(allAdded(files).some((line) => /\bif\b/.test(line))).toBe(true);
  });

  it("AC-6: always-true-matcher adds an expect.extend( line", () => {
    const files = read("always-true-matcher");
    expect(allAdded(files).some((line) => line.includes("expect.extend("))).toBe(true);
  });

  it("AC-6: replaced-test modifies one test file still at head, swapping one test opening line for one with another name", async () => {
    const files = read("replaced-test");
    expect(files).toHaveLength(1);
    const [file] = files as [FileDiff];
    expect(file.status).toBe("modified");
    expect(await isTestFile(file.path)).toBe(true);
    const repoFiles = fixture("skylos-nine/replaced-test/files.txt").trim().split("\n");
    expect(repoFiles).toContain(file.path);
    const removedNames = file.removed.flatMap((line) => OPENING.exec(line)?.[2] ?? []);
    const addedNames = file.added.flatMap((line) => OPENING.exec(line)?.[2] ?? []);
    expect(removedNames).toHaveLength(1);
    expect(addedNames).toHaveLength(1);
    expect(addedNames[0]).not.toBe(removedNames[0]);
  });

  it("AC-6: loosened-assertion removes a toBe( or toEqual( line and adds a toBeTruthy() line", () => {
    const files = read("loosened-assertion");
    expect(allRemoved(files).some((line) => line.includes("toBe(") || line.includes("toEqual("))).toBe(true);
    expect(allAdded(files).some((line) => line.includes("toBeTruthy()"))).toBe(true);
  });

  it("AC-6: edited-expected-value removes and adds a line with the same matcher and a different expected literal", () => {
    const files = read("edited-expected-value");
    const removed = allRemoved(files).flatMap((line) => {
      const match = MATCHER.exec(line);
      return match === null ? [] : [{ matcher: match[1], expected: (match[2] ?? "").trim() }];
    });
    const added = allAdded(files).flatMap((line) => {
      const match = MATCHER.exec(line);
      return match === null ? [] : [{ matcher: match[1], expected: (match[2] ?? "").trim() }];
    });
    const pair = removed.some((r) =>
      added.some((a) => a.matcher === r.matcher && a.expected !== r.expected && a.expected !== ""),
    );
    expect(pair, JSON.stringify({ removed, added })).toBe(true);
  });
});
