import { describe, expect, it } from "vitest";
import { indexTestFile } from "../src/testIndex/indexTestFile.js";
import type { TestBlock } from "../src/testIndex/types.js";

// CORE-52 (R2.3): the JS/TS test index reads how a test is switched off. A `skip`, `todo` or `fails` option in an object
// literal (second or third argument) adds a modifier; an `if` or an uncalled function between a block and its owner gives
// `guarded`; an empty `.each([])` or `.for([])` table gives `emptyTable`. Sources are written one line per string.

const BASE_KEYS = [
  "assertionCount",
  "assertions",
  "body",
  "bodyHash",
  "endLine",
  "guards",
  "kind",
  "line",
  "modifiers",
  "name",
  "nameDynamic",
  "path",
];

function blocks(...lines: string[]): TestBlock[] {
  const result = indexTestFile("src/a.test.ts", lines.join("\n"));
  if (!result.parsed) throw new Error(`refused: ${result.reason}`);
  return result.tests;
}

function only(name: string, list: TestBlock[]): TestBlock {
  const found = list.filter((b) => b.name === name);
  expect(found, `one block named ${name}`).toHaveLength(1);
  return found[0] as TestBlock;
}

describe("CORE-52: options in an object literal", () => {
  it.each([
    ['it("t", { skip: true }, () => {});', ["skip"]],
    ['it("t", { todo: true }, () => {});', ["todo"]],
    ['it("t", { fails: true }, () => {});', ["fails"]],
    ['it("t", () => {}, { skip: true });', ["skip"]],
    ['test("t", { "todo": true }, () => {});', ["todo"]],
    ['it("t", { skip: isWindows }, () => {});', ["skipIf"]],
    ['it("t", { skip: "flaky on CI" }, () => {});', ["skipIf"]],
    ['it("t", { todo: process.env.CI }, () => {});', ["skipIf"]],
    ['it("t", { skip: false }, () => {});', []],
    ['it("t", { timeout: 1000 }, () => {});', []],
    ['it("t", { retry: 2 }, () => {});', []],
    ['it("t", { ...base, timeout: 5 }, () => {});', []],
    ['it("t", () => {}, 1000);', []],
    ['it.concurrent("t", { skip: true, fails: cond }, () => {});', ["skip", "concurrent", "skipIf"]],
    ['it("t", { skip }, () => {});', ["skipIf"]],
    ['it("t", { [key]: true }, () => {});', []],
  ])("%s gives the modifiers %j", (line, modifiers) => {
    const block = only("t", blocks(line));
    expect(block.modifiers).toEqual(modifiers);
    expect(Object.keys(block).sort()).toEqual(BASE_KEYS);
  });

  it("an option on a describe is read too, and a hook's arguments are not read", () => {
    const list = blocks('describe("g", { skip: true }, () => {', "  beforeEach(() => {}, { skip: true });", "});");
    expect(only("g", list).modifiers).toEqual(["skip"]);
    expect(only("beforeEach", list).modifiers).toEqual([]);
  });

  it("an option the callee already carries is listed once", () => {
    expect(only("t", blocks('test.todo("t", { todo: true }, () => {});')).modifiers).toEqual(["todo"]);
  });
});

describe("CORE-52: guarded", () => {
  it("an if statement between a block and its owner gives guarded: if, in either branch", () => {
    const list = blocks(
      "if (process.env.CI) {",
      '  it("then", () => {});',
      "} else {",
      '  it("else", () => {});',
      "}",
      'describe("g", () => {',
      "  if (slow) {",
      '    it("nested", () => {});',
      "  }",
      "});",
    );
    expect(only("then", list).guarded).toBe("if");
    expect(only("else", list).guarded).toBe("if");
    expect(only("nested", list).guarded).toBe("if");
    expect(only("g", list).guarded).toBeUndefined();
  });

  it("a function nobody calls by name gives guarded: uncalled-function; one the file calls or passes does not", () => {
    const list = blocks(
      "function unused() {",
      '  it("in unused", () => {});',
      "}",
      "const alsoUnused = () => {",
      '  it("in arrow", () => {});',
      "};",
      "function helper() {",
      '  it("in helper", () => {});',
      "}",
      "helper();",
      "function passed() {",
      '  it("in passed", () => {});',
      "}",
      'describe("g", passed);',
      "(() => {",
      '  it("in iife", () => {});',
      "})();",
      "[1, 2].forEach((n) => {",
      '  it("in callback", () => {});',
      "});",
    );
    expect(only("in unused", list).guarded).toBe("uncalled-function");
    expect(only("in arrow", list).guarded).toBe("uncalled-function");
    expect(only("in helper", list).guarded).toBeUndefined();
    expect(only("in passed", list).guarded).toBeUndefined();
    expect(only("in iife", list).guarded).toBeUndefined();
    expect(only("in callback", list).guarded).toBeUndefined();
  });

  it("loops and describe callbacks are not guards, and the owner resets what sits above it", () => {
    const list = blocks(
      "for (const c of cases) {",
      '  it("in for-of", () => {});',
      "}",
      "for (let i = 0; i < 2; i++) {",
      '  it("in for", () => {});',
      "}",
      "if (flag) {",
      '  describe("guarded group", () => {',
      '    it("inside the group", () => {});',
      "  });",
      "}",
    );
    expect(only("in for-of", list).guarded).toBeUndefined();
    expect(only("in for", list).guarded).toBeUndefined();
    expect(only("guarded group", list).guarded).toBe("if");
    expect(only("inside the group", list).guarded).toBeUndefined();
  });

  it("a method, a property, a class field or an assignment is named by its key, and judged like a function", () => {
    const list = blocks(
      "class Suite {",
      "  register() {",
      '    it("in uncalled method", () => {});',
      "  }",
      "  field = () => {",
      '    it("in uncalled field", () => {});',
      "  };",
      "  constructor() {",
      '    it("in constructor", () => {});',
      "  }",
      "}",
      "const table = {",
      "  build: () => {",
      '    it("in called property", () => {});',
      "  },",
      '  "quoted": function () {',
      '    it("in quoted key", () => {});',
      "  },",
      "};",
      "table.build();",
      "exported.later = () => {",
      '  it("in property assignment", () => {});',
      "};",
      "let assigned;",
      "assigned = function () {",
      '  it("in assigned", () => {});',
      "};",
      "export default function () {",
      '  it("in default export", () => {});',
      "}",
    );
    expect(only("in uncalled method", list).guarded).toBe("uncalled-function");
    expect(only("in uncalled field", list).guarded).toBe("uncalled-function");
    expect(only("in constructor", list).guarded).toBeUndefined();
    expect(only("in called property", list).guarded).toBeUndefined();
    expect(only("in quoted key", list).guarded).toBeUndefined();
    expect(only("in property assignment", list).guarded).toBe("uncalled-function");
    expect(only("in assigned", list).guarded).toBeUndefined();
    expect(only("in default export", list).guarded).toBeUndefined();
  });

  it("an if inside a helper the file calls still guards, and the if is named before an uncalled function", () => {
    const list = blocks(
      "function helper() {",
      "  if (x) {",
      '    it("a", () => {});',
      "  }",
      "}",
      "helper();",
      "function unused() {",
      "  if (x) {",
      '    it("b", () => {});',
      "  }",
      "}",
    );
    expect(only("a", list).guarded).toBe("if");
    expect(only("b", list).guarded).toBe("if");
  });
});

describe("CORE-52: emptyTable", () => {
  it("an empty array literal table gives emptyTable: true; any other table does not", () => {
    const list = blocks(
      'it.each([])("empty each", () => {});',
      'it.for([])("empty for", () => {});',
      'describe.each([])("empty group", () => {});',
      'it.each([[1]])("one row", () => {});',
      'it.each(cases)("cases", () => {});',
      'it("plain", () => {});',
    );
    expect(only("empty each", list).emptyTable).toBe(true);
    expect(only("empty for", list).emptyTable).toBe(true);
    expect(only("empty group", list).emptyTable).toBe(true);
    expect(only("empty each", list).modifiers).toEqual(["each"]);
    for (const name of ["one row", "cases", "plain"]) {
      expect(only(name, list).emptyTable).toBeUndefined();
      expect(Object.keys(only(name, list)).sort()).toEqual(BASE_KEYS);
    }
  });
});
