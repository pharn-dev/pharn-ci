import { describe, expect, it } from "vitest";
import { readPackageScripts } from "../src/signals/packageScripts.js";
import { MAX_CONFIG_CHARS } from "../src/testConfig/value.js";
import { fixture } from "./helpers.js";

// The scripts object of a package.json text and the line of each of its keys (CORE-70).

const read = (text: string) => {
  const scripts = readPackageScripts(text);
  if (scripts === null) throw new Error("the text was not read");
  return scripts;
};

describe("readPackageScripts: the line of each key", () => {
  it("reads a one-line object: every key is on line 1", () => {
    const scripts = read(fixture("test-integrity/TI10/block-one-line-or-true/head/package.json.txt"));
    expect(scripts.values.get("test")).toBe("vitest run || true");
    expect(scripts.lines.get("test")).toBe(1);
  });

  it("reads a many-line object: each key is on its own line", () => {
    const scripts = read(fixture("test-integrity/TI10/pass-scripts-reflowed/head/package.json.txt"));
    expect([...scripts.lines]).toEqual([
      ["test", 4],
      ["pretest", 5],
      ["build", 6],
    ]);
    expect(scripts.values.get("pretest")).toBe("pnpm lint");
  });

  it("takes the last copy of a duplicated key, and of a duplicated scripts member", () => {
    const duplicatedKey = read('{\n"scripts": {\n"test": "a",\n"build": "b",\n"test": "c"\n}\n}');
    expect(duplicatedKey.values.get("test")).toBe("c");
    expect(duplicatedKey.lines.get("test")).toBe(5);

    const duplicatedScripts = read('{\n"scripts": {\n"test": "a"\n},\n"scripts": {\n"build": "b"\n}\n}');
    expect([...duplicatedScripts.values]).toEqual([["build", "b"]]);
    expect(duplicatedScripts.lines.get("build")).toBe(6);
    expect(duplicatedScripts.lines.has("test")).toBe(false);
  });

  it("does not read a scripts key nested in another object", () => {
    const scripts = read('{\n"config": {\n"scripts": {\n"test": "x"\n}\n},\n"scripts": {\n"test": "y"\n}\n}');
    expect(scripts.values.get("test")).toBe("y");
    expect(scripts.lines.get("test")).toBe(8);
  });

  it("decodes escapes in a key, and a value holding \\n comes back with a real line feed", () => {
    const scripts = read('{\n"scripts": {\n"te\\u0073t": "vitest run\\ntrue"\n}\n}');
    expect(scripts.values.get("test")).toBe("vitest run\ntrue");
    expect(scripts.lines.get("test")).toBe(3);
  });

  it("stores __proto__, constructor and toString keys with their own lines, in Maps", () => {
    const scripts = read(fixture("test-integrity/TI10/block-scripts-proto-keys/head/package.json.txt"));
    expect(scripts.values).toBeInstanceOf(Map);
    expect(scripts.lines).toBeInstanceOf(Map);
    expect(scripts.lines.get("__proto__")).toBe(4);
    expect(scripts.lines.get("constructor")).toBe(5);
    expect(scripts.lines.get("toString")).toBe(6);
    expect(scripts.lines.get("test")).toBe(7);
    expect(scripts.values.get("__proto__")).toBe("echo proto");
    expect(scripts.values.get("toString")).toBe("echo str");
  });

  it("reads a scripts that is absent or not an object as empty", () => {
    for (const text of ['{"name":"a"}', '{"scripts":"x"}', '{"scripts":[1]}']) {
      const scripts = read(text);
      expect(scripts.values.size, text).toBe(0);
      expect(scripts.lines.size, text).toBe(0);
    }
  });

  it("a string value that holds a colon or a brace does not move the keys", () => {
    const scripts = read('{\n"scripts": {\n"a": "x: {",\n"test": "y"\n}\n}');
    expect(scripts.lines.get("a")).toBe(3);
    expect(scripts.lines.get("test")).toBe(4);
  });

  it("returns null for invalid JSON, for text over the cap and for a text that is not an object", () => {
    expect(readPackageScripts('{"scripts": {')).toBeNull();
    expect(readPackageScripts(`{"x":"${"a".repeat(MAX_CONFIG_CHARS)}"}`)).toBeNull();
    expect(readPackageScripts("[1]")).toBeNull();
  });
});
