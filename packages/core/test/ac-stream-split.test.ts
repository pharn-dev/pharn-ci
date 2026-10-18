import { describe, expect, it } from "vitest";

// The splitter is imported inside the test body: the AC tests are written before packages/core/src/lines.ts exists,
// so nothing that depends on it may run while the file loads.

async function load() {
  return import("../src/lines.js");
}

async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const line of lines) out.push(line);
  return out;
}

async function* asAsync(chunks: readonly string[]): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk;
}

/** Cuts `text` into chunks of `size` characters (the last one may be shorter). */
function cut(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let at = 0; at < text.length; at += size) chunks.push(text.slice(at, at + size));
  return chunks;
}

// Each case is a chunk sequence; the expected lines are text.split(/\r?\n/) of the joined chunks.
const CASES: Record<string, readonly string[]> = {
  "CRLF endings": ["a\r\nb\r\n", "c\r\n"],
  "a lone CR inside a line": ["one\rtwo\nthree\r\n", "fo\rur"],
  "a CR ending one chunk and its LF starting the next": ["first\r", "\nsecond\r", "\r\nthird\r", "\n"],
  "empty chunks": ["", "a", "", "\n", "", "", "b", "", "\r", "", "\n", ""],
  "no final newline": ["alpha\nbeta\ngamma"],
  "a final newline": ["alpha\nbeta\ngamma\n"],
  "a final CRLF": ["alpha\r\nbeta\r\n"],
  "a trailing lone CR": ["alpha\nbeta\r"],
  "only newlines": ["\n", "\r\n", "\n\n", "\r", "\r", "\n"],
  "no chunks at all": [],
  "one empty chunk": [""],
  "a lone CR before CRLF": ["x\r\r\ny"],
};

describe("core line splitter", () => {
  it("AC-3: gives the lines text.split(/\\r?\\n/) gives for the joined chunks, whatever the chunk boundaries", async () => {
    const { createLineSplitter, splitLines, splitLinesAsync } = await load();

    const check = async (chunks: readonly string[], label: string) => {
      const expected = chunks.join("").split(/\r?\n/);

      expect([...splitLines(chunks)], `${label} (splitLines)`).toEqual(expected);
      expect(await collect(splitLinesAsync(asAsync(chunks))), `${label} (splitLinesAsync)`).toEqual(expected);

      const splitter = createLineSplitter();
      const pushed: string[] = [];
      for (const chunk of chunks) pushed.push(...splitter.push(chunk));
      pushed.push(...splitter.finish());
      expect(pushed, `${label} (createLineSplitter)`).toEqual(expected);
    };

    for (const [label, chunks] of Object.entries(CASES)) await check(chunks, label);

    // The same texts cut at every position into two chunks, and into chunks of 1, 2, 3 and 7 characters.
    for (const [label, chunks] of Object.entries(CASES)) {
      const text = chunks.join("");
      for (let at = 0; at <= text.length; at++) {
        await check([text.slice(0, at), text.slice(at)], `${label}, cut at ${at}`);
      }
      for (const size of [1, 2, 3, 7]) await check(cut(text, size), `${label}, chunks of ${size}`);
    }

    // Spot checks of the contract, independent of split(): a CR split from its LF is one CRLF.
    expect([...splitLines(["a\r", "\nb"])]).toEqual(["a", "b"]);
    expect([...splitLines(["a\rb"])]).toEqual(["a\rb"]);
    expect([...splitLines([])]).toEqual([""]);
    expect([...splitLines(["a\n"])]).toEqual(["a", ""]);
    expect([...splitLines(["a\r"])]).toEqual(["a\r"]);
  });
});
