import { describe, expect, it } from "vitest";

// indexPythonTests is loaded inside the test body: this test is written before it exists, so nothing the build adds
// may run while the file loads. The real interpreter runs; a missing python3 fails the test.

const SLOW = 60_000;

type Result = { parsed: true; tests: { name: string; line: number; endLine: number }[] } | { parsed: false };
type Run = { available: true; files: { path: string; result: Result }[] } | { available: false; reason: string };

/** One text with blocks, a decorator, a multi-line string, an assertion and a mock, as lines. */
const LINES = [
  "import pytest",
  "",
  "",
  '@pytest.mark.parametrize("x", [1, 2])',
  "def test_a(x):",
  '    s = """multi',
  '    line   string"""',
  "    assert x  ==  1  # c",
  "",
  "",
  "class TestB:",
  "    def test_c(self, mocker):",
  '        mocker.patch("os.getcwd")',
  "        assert self",
  "",
];

describe("indexPythonTests: line endings and a byte order mark", () => {
  it(
    "AC-8: LF, CRLF and CR endings and a leading U+FEFF give the same result, and the BOM text is parsed",
    async () => {
      const io = (await import("../src/index.js")) as unknown as {
        indexPythonTests: (files: { path: string; text: string }[]) => Promise<Run>;
      };
      const lf = LINES.join("\n");
      const forms: [label: string, text: string][] = [
        ["LF", lf],
        ["CRLF", LINES.join("\r\n")],
        ["CR", LINES.join("\r")],
        ["BOM + LF", `﻿${lf}`],
      ];
      const results: Result[] = [];
      for (const [label, text] of forms) {
        const run = await io.indexPythonTests([{ path: "tests/test_endings.py", text }]);
        if (!run.available) throw new Error(`${label}: the run is unavailable: ${JSON.stringify(run)}`);
        results.push((run.files[0] as { result: Result }).result);
      }

      const lfResult = results[0] as Result;
      if (!lfResult.parsed) throw new Error(`the LF text was refused: ${JSON.stringify(lfResult)}`);
      expect(lfResult.tests.map((b) => [b.name, b.line, b.endLine])).toEqual([
        ["test_a", 5, 8],
        ["TestB", 11, 14],
        ["test_c", 12, 14],
      ]);
      expect((results[3] as Result).parsed, "the BOM text is parsed").toBe(true);
      forms.forEach(([label], i) => {
        expect(results[i], `${label} gives the LF result`).toStrictEqual(lfResult);
      });
    },
    SLOW,
  );
});
