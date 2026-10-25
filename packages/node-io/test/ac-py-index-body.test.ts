import { describe, expect, it } from "vitest";

// indexPythonTests is loaded inside each test body: these tests are written before it exists, so nothing the build
// adds may run while the file loads. The real interpreter runs; a missing python3 fails the test. The Python text is
// built from string arrays, and every expected body is written here by hand.

const SLOW = 60_000;

type Block = { kind: string; name: string; body: string; bodyHash: string };
type Result = { parsed: true; tests: Block[] } | { parsed: false; reason: string };
type Run = { available: true; files: { path: string; result: Result }[] } | { available: false; reason: string };

async function indexOne(path: string, text: string): Promise<Block[]> {
  const io = (await import("../src/index.js")) as unknown as {
    indexPythonTests: (files: { path: string; text: string }[]) => Promise<Run>;
  };
  const run = await io.indexPythonTests([{ path, text }]);
  if (!run.available) throw new Error(`the run is unavailable: ${JSON.stringify(run)}`);
  const result = (run.files[0] as { result: Result }).result;
  if (!result.parsed) throw new Error(`the file was refused: ${JSON.stringify(result)}`);
  return result.tests;
}

/** 32-bit FNV-1a over UTF-16 code units, as 8 lowercase hex digits (#87's fnv1a32Hex). */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const byName = (tests: Block[], name: string) => {
  const block = tests.find((b) => b.name === name);
  if (block === undefined) throw new Error(`no block named ${name}: ${JSON.stringify(tests.map((b) => b.name))}`);
  return block;
};

const SOURCE = [
  "# zażółć gęślą jaźń 😀 — a comment before the tests, outside every body",
  "import os",
  "",
  "",
  "def test_body():",
  "    x  =  1   # first   comment",
  "    y = x\t\t+\t1",
  "",
  '    s = "a  b # not a comment"',
  "    b = b'c   d # e'",
  '    f = f"{x  +  1}  g # h"  # trailing comment',
  "",
  "",
  "def test_doc():",
  '    """Doc   string',
  '       kept   verbatim."""',
  "    assert  os  # why",
  "",
  "",
  "def test_unicode():",
  '    s = "żółw  🐢  x"   # komentarz ✓',
  "    assert   s",
  "",
].join("\n");

describe("indexPythonTests: the body text", () => {
  it(
    "AC-7: removes comments, collapses whitespace outside literals, keeps str, bytes and f-string literals verbatim, and hashes the body",
    async () => {
      const tests = await indexOne("tests/test_body.py", SOURCE);
      const cases: [name: string, body: string][] = [
        ["test_body", `x = 1 y = x + 1 s = "a  b # not a comment" b = b'c   d # e' f = f"{x  +  1}  g # h"`],
        ["test_doc", '"""Doc   string\n       kept   verbatim.""" assert os'],
        ["test_unicode", 's = "żółw  🐢  x" assert s'],
      ];
      for (const [name, body] of cases) {
        const block = byName(tests, name);
        expect(block.body, `the body of ${name}`).toBe(body);
        expect(block.bodyHash, `the bodyHash of ${name}`).toBe(fnv1a(body));
      }
    },
    SLOW,
  );

  it(
    "AC-7: a body longer than 4000 code units is cut to exactly 4000 and hashed in full",
    async () => {
      const statements = Array.from({ length: 600 }, (_, i) => `assert value(${i}) == ${i}`);
      const text = ["def test_long():", ...statements.map((s, i) => `    ${s}  # check ${i}`), ""].join("\n");
      const full = statements.join(" ");
      expect(full.length).toBeGreaterThan(4000);

      const block = byName(await indexOne("tests/test_long.py", text), "test_long");
      expect(block.body.length).toBe(4000);
      expect(block.body).toBe(full.slice(0, 4000));
      expect(block.bodyHash).toBe(fnv1a(full));
    },
    SLOW,
  );
});
