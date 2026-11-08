import { describe, expect, it } from "vitest";
import { MAX_TEST_IMPORTS } from "../src/testIndex/imports.js";
import { indexTestFile, indexTestFileWithImports } from "../src/testIndex/indexTestFile.js";
import { parseTestFile } from "../src/testIndex/parse.js";
import { walkTestFile } from "../src/testIndex/walk.js";
import { fixture } from "./helpers.js";

// A8 step 1 (tests exercise the changed lines): the test index also records the module specifiers a JS/TS test file
// loads at run time, from the same one parse. The fixture holds every form, the ones that count and the ones that do
// not (type-only imports, non-literal or two-argument `require`, mock paths).

describe("the module specifiers of a test file", () => {
  it("records static, side-effect, export-from, import-equals, require and dynamic imports of a literal, in source order, once each", () => {
    const text = fixture("exercise/imports/all-forms.test.ts.txt");
    const { result, imports } = indexTestFileWithImports("src/all-forms.test.ts", text);
    expect(result.parsed).toBe(true);
    expect(imports).toEqual([
      "vitest",
      "./default",
      "./namespace.js",
      "./side-effect",
      "./mixed",
      "./import-equals",
      "./export-from",
      "./export-star",
      "./required",
      "./template-literal",
      "./dynamic.js",
    ]);
  });

  it("leaves out type-only imports and exports, mock paths, a dynamic import passed to vi.mock, and a computed or two-argument specifier", () => {
    const { imports } = indexTestFileWithImports(
      "src/all-forms.test.ts",
      fixture("exercise/imports/all-forms.test.ts.txt"),
    );
    for (const left of [
      "./type-only",
      "./all-named-types",
      "./import-equals-type",
      "./export-type",
      "./two-args",
      "./mocked",
      "./do-mocked",
      "./mocked-import",
      "./jest-mocked",
    ]) {
      expect(imports, left).not.toContain(left);
    }
  });

  it("gives indexTestFile the same result as before: the index itself is unchanged", () => {
    const text = fixture("exercise/imports/all-forms.test.ts.txt");
    expect(indexTestFileWithImports("src/all-forms.test.ts", text).result).toEqual(
      indexTestFile("src/all-forms.test.ts", text),
    );
  });

  it("comes from the walk of the one parse", () => {
    const parsed = parseTestFile("ts", 'import "./a";\nexport * from "./b";\nimport type { C } from "./c";\n');
    if (!parsed.ok) throw new Error("the parse failed");
    const walked = walkTestFile(parsed.sourceFile);
    if (walked === "too-deep") throw new Error("the walk refused");
    expect(walked.imports).toEqual(["./a", "./b"]);
  });

  it("records nothing for a refused file", () => {
    const refused = indexTestFileWithImports("src/a.test.ts", `import "./a";\n${"x".repeat(600_000)}`);
    expect(refused).toEqual({ result: { parsed: false, reason: "too-large" }, imports: [] });
    expect(indexTestFileWithImports("src/a.test.ts", 'import "./a";\n'.concat(")".repeat(20))).imports).toEqual([]);
  });

  it(`keeps at most ${MAX_TEST_IMPORTS} distinct specifiers`, () => {
    const lines = Array.from({ length: MAX_TEST_IMPORTS + 50 }, (_, i) => `import "./m${i}";`);
    const { imports } = indexTestFileWithImports("src/many.test.ts", `${lines.join("\n")}\n`);
    expect(imports).toHaveLength(MAX_TEST_IMPORTS);
    expect(imports[0]).toBe("./m0");
    expect(imports[MAX_TEST_IMPORTS - 1]).toBe(`./m${MAX_TEST_IMPORTS - 1}`);
  });
});
