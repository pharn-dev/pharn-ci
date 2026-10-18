import { type CoverageFormatChoice, chooseCoverageFormat, DETECTION_PREFIX } from "./coverage/detect.js";
import { parseCoverage } from "./coverage/index.js";
import { createLcovReader } from "./coverage/lcov.js";
import type { CoverageFormatSelection, CoverageMap, ParseCoverageOptions } from "./coverage/types.js";
import { createUnifiedDiffReader, type DiffFile } from "./diff/unified.js";
import { createLineSplitter } from "./lines.js";

/**
 * Read one coverage file that arrives as a stream of text chunks.
 *
 * The first `DETECTION_PREFIX` characters settle the format (`chooseCoverageFormat`, which gives what the whole
 * text would give). An empty or unrecognized file is not read further: the stream is released with `return()` and
 * the map is empty. lcov is parsed line by line, so memory holds the coverage map and not the text. Cobertura is
 * parsed from one string, so a file past the longest string the engine can build fails with the engine's own
 * RangeError, which is not caught or reworded. A rejection of the stream rejects the promise; no partial map is
 * returned.
 */
export async function readCoverageChunks(
  chunks: AsyncIterable<string>,
  selection: CoverageFormatSelection,
  options: ParseCoverageOptions = {},
): Promise<{ choice: CoverageFormatChoice; parsed: CoverageMap }> {
  const iterator = chunks[Symbol.asyncIterator]();
  let finished = false;

  /** The next chunk, or null at the end of the stream. A stream that throws is finished too. */
  const pull = async (): Promise<string | null> => {
    try {
      const next = await iterator.next();
      if (next.done) {
        finished = true;
        return null;
      }
      return next.value;
    } catch (error) {
      finished = true;
      throw error;
    }
  };

  try {
    let prefix = "";
    while (prefix.length < DETECTION_PREFIX) {
      const chunk = await pull();
      if (chunk === null) break;
      prefix += chunk;
    }

    const choice = chooseCoverageFormat(prefix, selection);
    if (choice.format === "empty" || choice.format === "unknown") return { choice, parsed: new Map() };

    if (choice.format === "lcov") {
      const splitter = createLineSplitter();
      const reader = createLcovReader(options);
      const feed = (chunk: string): void => {
        for (const line of splitter.push(chunk)) reader.push(line);
      };
      feed(prefix);
      for (let chunk = await pull(); chunk !== null; chunk = await pull()) feed(chunk);
      for (const line of splitter.finish()) reader.push(line);
      return { choice, parsed: reader.finish() };
    }

    let text = prefix;
    for (let chunk = await pull(); chunk !== null; chunk = await pull()) text += chunk;
    return { choice, parsed: parseCoverage(text, choice.format, options) };
  } finally {
    if (!finished) await iterator.return?.();
  }
}

/**
 * Read a unified diff that arrives as a stream of text chunks, line by line. A rejection of the stream rejects the
 * promise, so a failed diff yields nothing.
 */
export async function readDiffChunks(chunks: AsyncIterable<string>): Promise<DiffFile[]> {
  const splitter = createLineSplitter();
  const reader = createUnifiedDiffReader();
  for await (const chunk of chunks) {
    for (const line of splitter.push(chunk)) reader.push(line);
  }
  for (const line of splitter.finish()) reader.push(line);
  return reader.finish();
}
