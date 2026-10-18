/**
 * Cut text that arrives in chunks into lines, with the same result as `joined.split(/\r?\n/)`.
 *
 * `push` returns every line a chunk completes (the text before each `\n`, with one trailing `\r` removed). The text
 * after the last `\n` stays pending, a trailing `\r` included, because the `\n` that completes the CRLF may start the
 * next chunk. `finish` returns the pending text as the last line; it is always one element, possibly empty, which is
 * what `split` gives for text that ends in a newline or is empty. Each chunk is scanned once.
 */
export function createLineSplitter(): { push(chunk: string): string[]; finish(): string[] } {
  let pending = "";

  const complete = (text: string): string => (text.endsWith("\r") ? text.slice(0, -1) : text);

  return {
    push(chunk: string): string[] {
      const lines: string[] = [];
      let from = 0;
      let newline = chunk.indexOf("\n", from);
      while (newline !== -1) {
        lines.push(complete(pending + chunk.slice(from, newline)));
        pending = "";
        from = newline + 1;
        newline = chunk.indexOf("\n", from);
      }
      pending += from === 0 ? chunk : chunk.slice(from);
      return lines;
    },
    finish(): string[] {
      const last = pending;
      pending = "";
      return [last];
    },
  };
}

/** The lines of chunks held in memory, as `joined.split(/\r?\n/)` would give them. */
export function* splitLines(chunks: Iterable<string>): Generator<string> {
  const splitter = createLineSplitter();
  for (const chunk of chunks) yield* splitter.push(chunk);
  yield* splitter.finish();
}

/** The lines of a stream of chunks, as `joined.split(/\r?\n/)` would give them. */
export async function* splitLinesAsync(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  const splitter = createLineSplitter();
  for await (const chunk of chunks) yield* splitter.push(chunk);
  yield* splitter.finish();
}
