/** One chunk: what a whole-text read gave. */
export async function* oneChunk(read: () => Promise<string>): AsyncGenerator<string> {
  yield await read();
}
