import { describe, expect, it } from "vitest";

// The package is loaded inside the test body: the AC test is written before `JS_TS_EXTENSIONS` and the `testLanguage`
// export exist, so nothing the build adds may run while the file loads.

const EXPECTED = ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"];

describe("@pharn-ci/core: JS_TS_EXTENSIONS", () => {
  it("AC-5: JS_TS_EXTENSIONS is exactly the eight JS/TS extensions, and each gives a test file by name read as jsts", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as {
      JS_TS_EXTENSIONS: readonly string[];
      isTestFile(path: string): boolean;
      testLanguage(path: string): "jsts" | "python" | "go" | null;
    };

    expect(Array.isArray(core.JS_TS_EXTENSIONS), "JS_TS_EXTENSIONS is an exported list").toBe(true);
    expect([...core.JS_TS_EXTENSIONS]).toEqual(EXPECTED);
    expect(typeof core.testLanguage, "testLanguage is exported").toBe("function");

    for (const ext of core.JS_TS_EXTENSIONS) {
      expect(core.isTestFile(`src/a.test.${ext}`), `src/a.test.${ext} is a test file`).toBe(true);
      expect(core.isTestFile(`src/a.spec.${ext}`), `src/a.spec.${ext} is a test file`).toBe(true);
      expect(core.testLanguage(`src/a.test.${ext}`), `src/a.test.${ext} reads as jsts`).toBe("jsts");
    }
  });
});
