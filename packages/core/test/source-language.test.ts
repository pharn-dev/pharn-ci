import { describe, expect, it } from "vitest";
import { JS_TS_EXTENSIONS, jsTsFlavor } from "../src/jsTsExtensions.js";
import { coverageSourceLanguage } from "../src/signals/signalFiles.js";
import { testLanguage } from "../src/signals/testLines.js";
import { languageOf } from "../src/signals/testPairs.js";
import { sourceLanguage } from "../src/sourceLanguage.js";

// CORE-142 group 4: the three extension-to-language mappers (languageOf for the test pairing, testLanguage for the
// one-line test readers, coverageSourceLanguage for the source-file signals) read one mapper, sourceLanguage. The table
// holds what each gave before the merge, for every extension any of them handled and the look-alikes around them.

type Row = [
  path: string,
  languageOf: string | null,
  testLanguage: string | null,
  coverageSourceLanguage: string | null,
];

const BEFORE: Row[] = [
  ...JS_TS_EXTENSIONS.map((ext): Row => [`src/a.${ext}`, jsTsFlavor(ext), "jsts", "jsts"]),
  ...JS_TS_EXTENSIONS.map((ext): Row => [`src/a.test.${ext}`, jsTsFlavor(ext), "jsts", "jsts"]),
  ["src/a.py", "py", "python", "python"],
  ["tests/test_a.py", "py", "python", "python"],
  ["src/a_test.go", null, "go", null],
  ["src/a.go", null, null, null],
  ["src/a.test.go", null, null, null],
  ["src/a.d.ts", "ts", "jsts", "jsts"],
  ["src/a.PY", null, null, null],
  ["src/a.Ts", null, null, null],
  ["src/a.tsx.bak", null, null, null],
  ["src/a.json", null, null, null],
  ["src/a.md", null, null, null],
  ["src/a.", null, null, null],
  ["Makefile", null, null, null],
  ["a.ts/b", null, null, null],
  ["a..py", "py", "python", "python"],
];

describe("one extension-to-language mapper", () => {
  it("gives what each of the three mappers gave, for every extension they handled", () => {
    for (const [path, pairing, oneLine, source] of BEFORE) {
      expect([languageOf(path), testLanguage(path), coverageSourceLanguage(path)], path).toEqual([
        pairing,
        oneLine,
        source,
      ]);
    }
  });

  it("a basename that is only an extension counts as that extension in all three (testLanguage's reading kept)", () => {
    // Before, testLanguage read `tests/.ts` as jsts and `tests/.py` as python while the other two gave null.
    expect([languageOf("tests/.ts"), testLanguage("tests/.ts"), coverageSourceLanguage("tests/.ts")]).toEqual([
      "ts",
      "jsts",
      "jsts",
    ]);
    expect([languageOf(".py"), testLanguage(".py"), coverageSourceLanguage(".py")]).toEqual(["py", "python", "python"]);
    expect(sourceLanguage(".gitignore")).toBeNull();
  });
});
