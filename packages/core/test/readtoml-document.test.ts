import { describe, expect, it } from "vitest";
import { readToml } from "../src/testConfig/readToml.js";
import type { ConfigValue } from "../src/testConfig/value.js";
import { fixture } from "./helpers.js";

// CORE-142 group 2: the pytest-table reader of pyproject.toml (TI09) is built on the TOML document reader of
// dependency safety (dependencies/toml.ts), so it gets that reader's fixes: CORE-94 (R3.5, a multi-line string with
// escaped quotes) and CORE-114 (R4.4, a table is the same whether written as a header, dotted keys or an inline table).

/** A config value as plain data: an object's entries as `{ key: [line, value] }`. */
function plain(value: ConfigValue | null): unknown {
  if (value === null) return null;
  if (value.type === "object") {
    return Object.fromEntries([...value.entries].map(([key, entry]) => [key, [entry.line, plain(entry.value)]]));
  }
  if (value.type === "array") return value.items.map(plain);
  if (value.type === "opaque") return { opaque: value.text };
  if (value.type === "null") return null;
  return value.value;
}

const read = (text: string) => {
  const result = readToml(text);
  return result.ok ? plain(result.root) : result.reason;
};

describe("readToml on the TOML document reader", () => {
  it("R3.5 and R4.4 together: a file with an escaped multi-line description and a pytest table in dotted keys", () => {
    expect(read(fixture("test-config-toml/escaped-dotted.toml.txt"))).toEqual({
      addopts: [6, "-ra"],
      testpaths: [7, ["tests"]],
    });
  });

  it("R4.4: the ini_options table reads the same as a header, a quoted header, dotted keys and an inline table", () => {
    const expected = { addopts: [2, "-q"], testpaths: [2, ["tests"]] };
    const spellings = [
      '[tool.pytest.ini_options]\naddopts = "-q"\ntestpaths = ["tests"]\n',
      '[tool."pytest".ini_options]\naddopts = "-q"\ntestpaths = ["tests"]\n',
      '[ tool . pytest . ini_options ]\naddopts = "-q"\ntestpaths = ["tests"]\n',
      '[tool]\npytest.ini_options.addopts = "-q"\npytest.ini_options.testpaths = ["tests"]\n',
      '[tool.pytest]\nini_options.addopts = "-q"\nini_options.testpaths = ["tests"]\n',
      'tool.pytest.ini_options.addopts = "-q"\ntool.pytest.ini_options.testpaths = ["tests"]\n',
      '[tool]\npytest = { ini_options = { addopts = "-q", testpaths = ["tests"] } }\n',
      '[tool.pytest]\nini_options = { addopts = "-q", testpaths = ["tests"] }\n',
    ];
    for (const text of spellings) {
      const root = read(text) as Record<string, [number, unknown]>;
      // The line of each key is its own line in that spelling; the values are the same.
      expect(Object.keys(root), text).toEqual(["addopts", "testpaths"]);
      expect(Object.fromEntries(Object.entries(root).map(([key, [, value]]) => [key, value])), text).toEqual(
        Object.fromEntries(Object.entries(expected).map(([key, [, value]]) => [key, value])),
      );
    }
  });

  it("R4.4: the native [tool.pytest] table in dotted keys and inline, merged with ini_options as before", () => {
    expect(read('[tool]\npytest.testpaths = ["unit"]\npytest.ini_options.addopts = "-q"\n')).toEqual({
      addopts: [3, "-q"],
      testpaths: [2, ["unit"]],
    });
    expect(read('[tool.pytest.ini_options]\ntestpaths = ["a"]\n[tool.pytest]\ntestpaths = ["b"]\n')).toEqual({
      testpaths: [4, ["b"]],
    });
  });

  it("keeps what the line reader gave: scalars, opaque values, dotted keys inside a table, sub-tables left out", () => {
    const text = [
      "[tool.pytest.ini_options]",
      "minversion = 6.0",
      "xfail_strict = true",
      "timeout = 1_000",
      'filterwarnings = ["error", [1, 2], {a = 1}] # nested items are opaque',
      'markers = """',
      "slow: slow tests",
      '"""',
      "date = 1979-05-27",
      'env = { CI = "1" }',
      'custom.key = "x"',
      "literal = 'C:\\path'",
      "[tool.pytest.ini_options.sub]",
      "ignored = 1",
      "[tool.pytest.foo]",
      "ignored = 2",
    ].join("\n");
    expect(read(text)).toEqual({
      minversion: [2, 6],
      xfail_strict: [3, true],
      timeout: [4, 1000],
      filterwarnings: [5, ["error", { opaque: "[1,2]" }, { opaque: "{a=1}" }]],
      // The whole multi-line string, where the line reader kept its first line only (`"""`), so an edit on a later line
      // now changes the opaque text.
      markers: [6, { opaque: '"""\nslow: slow tests\n"""' }],
      date: [9, { opaque: "1979-05-27" }],
      env: [10, { opaque: '{CI="1"}' }],
      "custom.key": [11, "x"],
      literal: [12, "C:\\path"],
    });
  });

  it("a table only named on the way to a deeper header is not present; an empty table is", () => {
    expect(read("[tool.pytest.ini_options.sub]\nx = 1\n")).toBeNull();
    expect(read("[tool.pytest.ini_options]\n")).toEqual({});
    expect(read('[project]\nname = "demo"\n')).toBeNull();
  });

  it("refuses a text that is not valid TOML anywhere in the file, as pytest does", () => {
    expect(read('[project]\nname = "a"\nname = "b"\n[tool.pytest.ini_options]\naddopts = "-q"\n')).toBe("invalid-toml");
    expect(read('[tool.pytest.ini_options]\naddopts = "-q"\n[tool.pytest.ini_options]\naddopts = "-x"\n')).toBe(
      "invalid-toml",
    );
  });
});
