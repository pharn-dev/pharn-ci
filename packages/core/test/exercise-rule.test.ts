import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../src/diff/unified.js";
import { detectUnexercisedChanges, exerciseCandidates } from "../src/signals/exercise.js";
import { resolveRelativeModule } from "../src/signals/mockTargets.js";
import { indexTouchedTestFiles } from "../src/signals/testPairs.js";
import { fixture } from "./helpers.js";

// A8 step 1: the rule's parts, below check(). The candidates come from fixtures/exercise/pass-not-checked; the
// resolution and evidence cases are small diffs written here, each with the head text of its one test file.

const none = () => false;

const HUNK = ["@@ -1,0 +2 @@", "+export const b = 2;"];

/** A modified entry that adds line 2. */
const modified = (path: string) => [
  `diff --git a/${path} b/${path}`,
  "index 1111111..2222222 100644",
  `--- a/${path}`,
  `+++ b/${path}`,
  ...HUNK,
];

/** An added file of one line. */
const added = (path: string) =>
  [`diff --git a/${path} b/${path}`, "new file mode 100644", "index 0000000..2222222", "--- /dev/null", `+++ b/${path}`]
    .concat(HUNK)
    .map((line) => line.replace("@@ -1,0 +2 @@", "@@ -0,0 +1 @@"));

/** A rename from `from` to `path`: without a hunk, or with one added line. */
const renamed = (from: string, path: string, edited: boolean) => {
  const head = [`diff --git a/${from} b/${path}`, `similarity index ${edited ? 90 : 100}%`];
  const names = [`rename from ${from}`, `rename to ${path}`];
  return edited ? [...head, ...names, `--- a/${from}`, `+++ b/${path}`, ...HUNK] : [...head, ...names];
};

const diffOf = (...entries: string[][]) => parseUnifiedDiff(`${entries.flat().join("\n")}\n`);

const testText = (specifier: string) =>
  `import { b } from "${specifier}";\nit("b", () => {\n  expect(b).toBe(2);\n});\n`;

const side = (files: Record<string, string>) => ({
  files: Object.entries(files).map(([path, text]) => ({ path, text })),
  dropped: [],
});

type Files = Record<string, string>;
const touchedFor = (diff: ReturnType<typeof diffOf>, head: Files, base: Files = {}) =>
  indexTouchedTestFiles(diff, { base: side(base), head: side(head) }, undefined);

describe("exerciseCandidates", () => {
  it("keeps only JS/TS source files with an added line that are not tests, declarations, config, generated, build output or excluded", () => {
    const diff = parseUnifiedDiff(fixture("exercise/pass-not-checked/change.diff"));
    expect(exerciseCandidates(diff, none)).toEqual(["src/excluded.ts"]);
    expect(exerciseCandidates(diff, (path) => path === "src/excluded.ts")).toEqual([]);
  });
});

describe("resolveRelativeModule", () => {
  const known = new Set(["src/a.ts", "src/a.js", "src/b.mts", "src/dir/index.tsx", "lib/c.cjs", "src/d.ts"]);
  const lookup = (candidate: string) => (known.has(candidate) ? candidate : undefined);
  const resolve = (from: string, specifier: string) => resolveRelativeModule(from, specifier, lookup);

  it("joins ./ and ../ to the test's directory and tries the path, its TypeScript twin, the extensions and /index", () => {
    expect(resolve("src/a.test.ts", "./a"), "TypeScript before JavaScript").toBe("src/a.ts");
    expect(resolve("src/a.test.ts", "./a.js"), "the path itself first").toBe("src/a.js");
    expect(resolve("src/a.test.ts", "./d.js"), "the .js spelling of a .ts file").toBe("src/d.ts");
    expect(resolve("src/a.test.ts", "./b.mjs"), "the .mjs spelling of a .mts file").toBe("src/b.mts");
    expect(resolve("test/x.test.ts", "../src/dir"), "a directory's index").toBe("src/dir/index.tsx");
    expect(resolve("lib/sub/c.test.js", "../c")).toBe("lib/c.cjs");
    expect(resolve("src/a.test.ts", "././/a"), "empty and dot segments").toBe("src/a.ts");
  });

  it("resolves bare, alias, absolute and root-escaping specifiers to nothing", () => {
    for (const specifier of ["a", "@/a", "~/a", "#a", "/src/a", "src/a", "../../a", ".", ".."]) {
      expect(resolve("src/a.test.ts", specifier), specifier).toBeNull();
    }
  });
});

describe("detectUnexercisedChanges", () => {
  it("resolves against the tracked files first: ./a names the unchanged a.ts, so the changed a.js is not exercised", () => {
    const diff = diffOf(modified("src/a.js"), added("src/a.test.ts"));
    const touched = touchedFor(diff, { "src/a.test.ts": testText("./a") });
    const tracked = ["src/a.js", "src/a.test.ts", "src/a.ts"];
    expect(detectUnexercisedChanges(diff, touched, tracked, none)).toEqual({ checked: 1, notExercised: ["src/a.js"] });
    // Without tracked files (git failed) the diff's own paths are known, and ./a names a.js.
    expect(detectUnexercisedChanges(diff, touched, [], none)).toEqual({ checked: 1, notExercised: [] });
  });

  it("counts a test file renamed with edits, and not one renamed without edits", () => {
    const base = { "src/old.test.ts": testText("./a") };
    const head = { "src/new.test.ts": testText("./a") };
    const tracked = ["src/a.ts", "src/new.test.ts"];
    const edited = diffOf(modified("src/a.ts"), renamed("src/old.test.ts", "src/new.test.ts", true));
    expect(detectUnexercisedChanges(edited, touchedFor(edited, head, base), tracked, none)).toEqual({
      checked: 1,
      notExercised: [],
    });
    const moved = diffOf(modified("src/a.ts"), renamed("src/old.test.ts", "src/new.test.ts", false));
    expect(detectUnexercisedChanges(moved, touchedFor(moved, head, base), tracked, none)).toEqual({
      checked: 1,
      notExercised: ["src/a.ts"],
    });
  });

  it("gives null when nothing is checked", () => {
    const diff = diffOf(modified("README.md"), added("src/a.test.ts"));
    expect(detectUnexercisedChanges(diff, touchedFor(diff, { "src/a.test.ts": testText("./a") }), [], none)).toBeNull();
  });
});
