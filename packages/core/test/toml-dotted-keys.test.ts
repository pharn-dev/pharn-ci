import { describe, expect, it } from "vitest";
import { parseToml, parseTomlDocument, type TomlValue, valueAt } from "../src/dependencies/toml.js";

// CORE-114 (R4.4): parseTomlDocument reads a TOML file as one nested table. A dotted key (`a.b = 1`, also inside an
// inline table) is `a → b`, a `[a.b]` header is `root → a → b`, and `[[a]]` appends a table to the array `a`, so a key
// reads the same whichever of TOML's spellings wrote it. What the TOML spec forbids makes the file unreadable.

/** A value as plain data: strings, arrays and tables (keys in order); `other` as null. */
const plain = (value: TomlValue | undefined): unknown => {
  if (value === undefined) return undefined;
  if (value.type === "string") return value.value;
  if (value.type === "array") return value.items.map(plain);
  if (value.type === "table") return Object.fromEntries([...value.entries].map(([k, v]) => [k, plain(v)]));
  return null;
};
const doc = (text: string) => {
  const parsed = parseTomlDocument(text);
  expect(parsed, text).not.toBeNull();
  return plain(parsed?.root);
};

describe("parseTomlDocument: dotted keys fold into nested tables", () => {
  it("on a key line, in the top-level table and under a header", () => {
    expect(doc('a.b = "1"\na.c = "2"\n[t]\nx.y.z = "3"\nx.y.w = "4"\n')).toEqual({
      a: { b: "1", c: "2" },
      t: { x: { y: { z: "3", w: "4" } } },
    });
  });

  it("inside an inline table, and with spaces and quoted parts", () => {
    expect(doc('t = { a.b = "1", a . c = "2", "x.y".z = "3", \'q\'.r = "4" }\n')).toEqual({
      t: { a: { b: "1", c: "2" }, "x.y": { z: "3" }, q: { r: "4" } },
    });
  });

  it("gives the same tree for a sub-table, an inline table and dotted keys", () => {
    const sub = doc('[[package]]\nname = "x"\n\n[package.source]\ntype = "url"\nurl = "u"\n');
    const inline = doc('[[package]]\nname = "x"\nsource = { type = "url", url = "u" }\n');
    const dotted = doc('[[package]]\nname = "x"\nsource.type = "url"\nsource.url = "u"\n');
    const staticArray = doc('package = [{ name = "x", source = { type = "url", url = "u" } }]\n');
    const expected = { package: [{ name: "x", source: { type: "url", url: "u" } }] };
    expect([sub, inline, dotted, staticArray]).toEqual([expected, expected, expected, expected]);
  });

  it("attaches a sub-table header to the last element of an array table", () => {
    expect(doc('[[p]]\nn = "1"\n[p.s]\nu = "a"\n[[p]]\nn = "2"\n[p.s]\nu = "b"\n[[p.w]]\nf = "c"\n')).toEqual({
      p: [
        { n: "1", s: { u: "a" } },
        { n: "2", s: { u: "b" }, w: [{ f: "c" }] },
      ],
    });
  });

  it("lets a header define a table an earlier header only named, and add a sub-table to a dotted one", () => {
    expect(doc('[a.b]\nx = "1"\n[a]\ny = "2"\n')).toEqual({ a: { b: { x: "1" }, y: "2" } });
    expect(doc('[fruit]\napple.color = "red"\n[fruit.apple.texture]\nsmooth = "yes"\n')).toEqual({
      fruit: { apple: { color: "red", texture: { smooth: "yes" } } },
    });
    expect(doc('[a.b.c]\nz = "1"\n[a]\nb.d = "2"\n')).toEqual({ a: { b: { c: { z: "1" }, d: "2" } } });
  });

  it("reads an inline table across lines with a trailing comma (TOML 1.1, as poetry's and uv's readers do)", () => {
    expect(doc('source = {\n    url = "u",\n}\n')).toEqual({ source: { url: "u" } });
  });

  it("records the line of the header that defined a table, or of the first dotted key that made it", () => {
    const parsed = parseTomlDocument('[a.b]\n\n[a]\nc.d = "1"\nc.e = "2"\n');
    expect(valueAt(parsed?.root ?? { type: "table", entries: new Map(), line: 0 }, ["a"])?.line).toBe(3);
    expect(parsed && valueAt(parsed.root, ["a", "b"])?.line).toBe(1);
    expect(parsed && valueAt(parsed.root, ["a", "c"])?.line).toBe(4);
    expect(parsed && valueAt(parsed.root, ["a", "c", "e"])?.line).toBe(5);
    expect(parsed && valueAt(parsed.root, ["a", "c", "e", "f"])).toBeUndefined();
    expect(parsed && valueAt(parsed.root, ["missing"])).toBeUndefined();
  });

  it("keeps the headers in file order, each with the keys written under it, dotted keys nested", () => {
    const tables = parseToml('a.b = "1"\n[t]\nx.y = "2"\nz = "3"\n[t.u]\nv = "4"\n[[arr]]\nc = "5"\n');
    expect(
      tables?.map((t) => [t.path.join("."), t.array, t.line, plain({ type: "table", entries: t.entries, line: 0 })]),
    ).toEqual([
      ["", false, 1, { a: { b: "1" } }],
      ["t", false, 2, { x: { y: "2" }, z: "3" }],
      ["t.u", false, 5, { v: "4" }],
      ["arr", true, 7, { c: "5" }],
    ]);
  });
});

describe("parseTomlDocument: what TOML forbids is unreadable", () => {
  it.each([
    ["a key defined twice", 'a = "1"\na = "2"\n'],
    ["a key defined twice in an inline table", 't = { a = "1", a = "2" }\n'],
    ["a dotted key that redefines a value", 'a = "1"\na.b = "2"\n'],
    ["a key that redefines a dotted table", 'a.b = "1"\na = "2"\n'],
    ["a dotted key past a value", 'a.b = "1"\na.b.c = "2"\n'],
    ["a table header written twice", '[a]\nx = "1"\n[a]\ny = "2"\n'],
    ["a sub-table header written twice", '[[p]]\n[p.s]\nu = "1"\n[p.s]\nv = "2"\n'],
    ["a header that reopens a table dotted keys defined", '[fruit]\napple.color = "red"\n[fruit.apple]\nx = "1"\n'],
    ["a dotted key that extends a table a header defined", '[a.b]\nx = "1"\n[a]\nb.y = "2"\n'],
    ["a dotted key into a table a deeper header defined", '[a.b.c]\nz = "1"\n[a]\nb.c.t = "2"\n'],
    ["a dotted key that extends an inline table", 'a = { b = "1" }\na.c = "2"\n'],
    ["a dotted key that extends an inline table inside one", 't = { a = { b = "1" }, a.c = "2" }\n'],
    ["a header that extends an inline table", 'a = { b = "1" }\n[a.c]\n'],
    ["a header inside an inline table", 'a = { b = { c = "1" } }\n[a.b.d]\n'],
    ["a header that reopens a value", 'a = "1"\n[a]\n'],
    ["an array table over a static array", "a = []\n[[a]]\n"],
    ["a header under a static array", 'a = [{ b = "1" }]\n[a.c]\n'],
    ["a table header over an array table", "[[a]]\n[a]\n"],
    ["an array table over a table", "[a]\n[[a]]\n"],
    ["a dotted key into an array table", '[[b.c]]\n[b]\nc.x = "1"\n'],
    ["a source sub-table after dotted source keys", '[[package]]\nsource.url = "u"\n[package.source]\ntype = "url"\n'],
    ["a value on the line after its key in an inline table", 'a = [ { url =\n"u" } ]\n'],
  ])("%s", (_name, text) => {
    expect(parseTomlDocument(text)).toBeNull();
    expect(parseToml(text)).toBeNull();
  });

  it("caps a dotted key at 32 parts", () => {
    const key = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`).join(".");
    expect(parseTomlDocument(`${key(32)} = "1"\n`)).not.toBeNull();
    expect(parseTomlDocument(`${key(33)} = "1"\n`)).toBeNull();
    expect(parseTomlDocument(`[${key(33)}]\n`)).toBeNull();
  });
});
