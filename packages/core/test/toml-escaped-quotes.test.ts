import { describe, expect, it } from "vitest";
import { parseToml } from "../src/dependencies/toml.js";
import { readToml } from "../src/testConfig/readToml.js";
import { dependencyCase, run } from "./dependencies-helpers.js";
import { fixture } from "./helpers.js";

// CORE-94: a multi-line basic string ("""...""") is read character by character with its backslash escapes, so an
// escaped quote does not close it. Before, the TOML readers closed it at the first `"""`, read the rest of a valid
// pyproject.toml as broken TOML, and the dependency check skipped the file with a warning.

/** The value of key `d` in a one-line TOML text, or null when the text does not parse. */
const stringD = (text: string) => {
  const tables = parseToml(text);
  return tables === null ? null : (tables[0]?.entries.get("d") ?? null);
};

describe("parseToml: multi-line basic strings", () => {
  it("does not close on an escaped quote: the escapes are decoded", () => {
    expect(stringD('d = """A \\"""quoted\\""" word"""\n')).toEqual({
      type: "string",
      value: 'A """quoted""" word',
      line: 1,
    });
  });

  it("closes after an escaped backslash", () => {
    expect(stringD('d = """a\\\\"""\n')).toEqual({ type: "string", value: "a\\", line: 1 });
  });

  it("closes a run of more than three quotes on its last three", () => {
    expect(stringD('d = """a"""""\n')).toEqual({ type: "string", value: 'a""', line: 1 });
    expect(stringD('d = """a""""\n')).toEqual({ type: "string", value: 'a"', line: 1 });
  });

  it("still refuses an unterminated string, also when its only closing quotes are escaped", () => {
    for (const bad of ['d = """open\n', 'd = """a \\"""\n', 'd = """a\nb\n', 'd = """a \\q"""\n']) {
      expect(parseToml(bad), bad).toBeNull();
    }
  });

  it("drops the line break after the opening quotes and a line-ending backslash with the whitespace after it", () => {
    expect(stringD('d = """\n  one \\\n\n    two\nthree"""\n')).toEqual({
      type: "string",
      value: "  one two\nthree",
      line: 1,
    });
    expect(stringD('d = """\\u0041\\tb"""\n')).toEqual({ type: "string", value: "A\tb", line: 1 });
  });

  it("leaves literal multi-line strings without escapes", () => {
    expect(stringD("d = '''a \\'''\n")).toEqual({ type: "string", value: "a \\", line: 1 });
  });

  it("reads the existing fixture's multi-line description as before", () => {
    const tables = parseToml(fixture("dependencies/python-uv-drift/head/pyproject.toml.txt"));
    expect(tables?.[1]?.entries.get("description")).toEqual({ type: "string", value: "A small app.", line: 4 });
  });
});

describe("readToml: multi-line strings in the pytest table", () => {
  const table = (value: string) => `[tool.pytest.ini_options]\naddopts = ${value}\ntestpaths = ["tests"]\n`;
  const keys = (text: string) => {
    const result = readToml(text);
    if (!result.ok) return result.reason;
    const root = result.root;
    return root?.type === "object" ? [...root.entries.entries()].map(([key, entry]) => [key, entry.line]) : null;
  };

  it("does not close on an escaped quote, and closes after an escaped backslash", () => {
    expect(keys(table('"""\n-q \\"""x\\"""\n"""'))).toEqual([
      ["addopts", 2],
      ["testpaths", 5],
    ]);
    expect(keys(table('"""\na\\\\"""'))).toEqual([
      ["addopts", 2],
      ["testpaths", 4],
    ]);
    expect(keys(table('"""a \\\n\\"""b"""'))).toEqual([
      ["addopts", 2],
      ["testpaths", 4],
    ]);
  });

  it("refuses a string whose only closing quotes are escaped, and leaves literal strings without escapes", () => {
    expect(keys('[tool.pytest.ini_options]\naddopts = """\n-q \\"""\n')).toBe("invalid-toml");
    expect(keys(table("'''\na \\'''"))).toEqual([
      ["addopts", 2],
      ["testpaths", 4],
    ]);
  });
});

describe("dependency safety on a pyproject.toml with an escaped description", () => {
  it("python-escaped-description: reads the file and reports the added git dependency as D05", () => {
    const report = run(dependencyCase("python-escaped-description"));
    expect(report.dependencies?.unread).toBeUndefined();
    expect(
      report.dependencies?.signals.map((s) => [s.id, s.severity, s.path, s.line, s.name ?? null, s.detail]),
    ).toEqual([["D05", "block", "pyproject.toml", 8, "my-lib", "declared from a git repository"]]);
    expect(report.messages.filter((m) => m.code.startsWith("DEPENDENCY_")).map((m) => [m.level, m.code])).toEqual([
      ["error", "DEPENDENCY_D05"],
    ]);
    expect(report.verdict).toBe("fail");
  });
});
