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

async function parseTimed(text: string, repoRoot?: string) {
  const { parseCobertura } = await import("../src/coverage/cobertura.js");
  const started = performance.now();
  const map = parseCobertura(text, repoRoot === undefined ? {} : { repoRoot });
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

  // F-24: every relative filename used to be joined to every distinct <source>, so thousands of each took seconds.
  const COUNT = 4_000;
  const ROOT = "/home/runner/work/demo/demo";

  function manySources(sources: readonly string[], filenames: readonly string[]): string {
    const sourceXml = sources.map((source) => `<source>${source}</source>`).join("");
    const classXml = filenames
      .map((name) => `<class filename="${name}"><lines><line number="1" hits="1"/></lines></class>`)
      .join("");
    return `<coverage><sources>${sourceXml}</sources><packages><package><classes>${classXml}</classes></package></packages></coverage>`;
  }

  const outside = (count: number) => Array.from({ length: count }, (_, i) => `/opt/build/s${i}`);
  const names = (prefix: string) => Array.from({ length: COUNT }, (_, i) => `${prefix}${i}.py`);

  it("F-24: thousands of sources outside the root times thousands of filenames resolve in linear time", async () => {
    const filenames = names("pkg/f");
    const { map, elapsed } = await parseTimed(manySources([...outside(COUNT), `${ROOT}/src`], filenames), ROOT);
    expect(map).toEqual(Object.fromEntries(filenames.map((name) => [`src/${name}`, { 1: 1 }])));
    expect(elapsed).toBeLessThan(LIMIT_MS);
  }, 30_000);

  it("F-24: thousands of case variants of an ancestor of a Windows root resolve in linear time", async () => {
    // Each source differs from C:/runner/work/demo only in letter case, so under the case-insensitive drive root
    // C:/runner/work/demo/demo each is an ancestor that a filename could still continue into the root.
    const caseVariant = (text: string, n: number) => {
      let bit = 0;
      return [...text].map((char) => (/[a-z]/.test(char) && (n >> bit++) & 1 ? char.toUpperCase() : char)).join("");
    };
    const variants = Array.from({ length: COUNT }, (_, i) => `C:\\${caseVariant("runner\\work\\demo", i)}`);
    const filenames = names("pkg/f");
    const text = manySources([...variants, "C:\\runner\\work\\demo\\demo\\src"], filenames);
    const { map, elapsed } = await parseTimed(text, "C:\\runner\\work\\demo\\demo");
    expect(map).toEqual(Object.fromEntries(filenames.map((name) => [`src/${name}`, { 1: 1 }])));
    expect(elapsed).toBeLessThan(LIMIT_MS);
  }, 30_000);

  it("F-24: thousands of filenames starting with .. are joined to at most 16 sources, in linear time", async () => {
    const filenames = names("../pkg/g");
    const { map, elapsed } = await parseTimed(manySources([...outside(COUNT), `${ROOT}/src`], filenames), ROOT);
    expect(map).toEqual(Object.fromEntries(filenames.map((name) => [name, { 1: 1 }])));
    expect(elapsed).toBeLessThan(LIMIT_MS);
  }, 30_000);
});
