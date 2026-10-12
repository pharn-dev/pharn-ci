import { describe, expect, it } from "vitest";

// The parser is imported inside each test body: the AC tests are written before it exists. The hostile inputs are
// built in the test, about 4 MB each; only the parse call is timed.

const VALID =
  '<coverage><packages><package name="p"><classes><class name="a" filename="src/a.py"><lines><line number="1" hits="1"/></lines></class></classes></package></packages></coverage>';
const EXPECTED = { "src/a.py": { 1: 1 } };
const SIZE = 4_000_000;
const LIMIT_MS = 1000;

const JUNK = '<class filename="x.py"><lines><line number="1" hits="1"/>';
const junk = () => JUNK.repeat(Math.ceil(SIZE / JUNK.length));

async function parseTimed(text: string) {
  const { parseCobertura } = await import("../src/coverage/cobertura.js");
  const started = performance.now();
  const map = parseCobertura(text);
  const elapsed = performance.now() - started;
  return {
    map: Object.fromEntries([...map].map(([path, hits]) => [path, Object.fromEntries(hits)])),
    elapsed,
  };
}

describe("parseCobertura: hostile input", () => {
  it("AC-16: an unterminated comment of several megabytes parses in linear time", async () => {
    const { map, elapsed } = await parseTimed(`${VALID}<!--${junk()}`);
    expect(map).toEqual(EXPECTED);
    expect(elapsed).toBeLessThan(LIMIT_MS);
  }, 30_000);

  it("AC-16: an unterminated CDATA section of several megabytes parses in linear time", async () => {
    const { map, elapsed } = await parseTimed(`${VALID}<![CDATA[${junk()}`);
    expect(map).toEqual(EXPECTED);
    expect(elapsed).toBeLessThan(LIMIT_MS);
  }, 30_000);

  it("AC-16: an unterminated quoted attribute of several megabytes parses in linear time", async () => {
    const { map, elapsed } = await parseTimed(`${VALID}<class filename="${"a".repeat(SIZE)}`);
    expect(map).toEqual(EXPECTED);
    expect(elapsed).toBeLessThan(LIMIT_MS);
  }, 30_000);

  it("AC-16: a run of several million < characters parses in linear time", async () => {
    const { map, elapsed } = await parseTimed(`${"<".repeat(SIZE)}${VALID}`);
    expect(map).toEqual(EXPECTED);
    expect(elapsed).toBeLessThan(LIMIT_MS);
  }, 30_000);

  it("AC-16: many thousands of nested open tags around a valid class parse in linear time", async () => {
    const depth = 300_000;
    const { map, elapsed } = await parseTimed(`${"<n>".repeat(depth)}${VALID}${"</n>".repeat(depth)}`);
    expect(map).toEqual(EXPECTED);
    expect(elapsed).toBeLessThan(LIMIT_MS);
  }, 30_000);
});
