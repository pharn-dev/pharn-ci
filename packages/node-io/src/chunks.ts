/** What the git chunk fallback needs from the deps of the CLI or the Action. */
export interface GitChunkDeps {
  git(args: string[]): Promise<string>;
  gitStream?(args: string[]): AsyncIterable<string>;
}

/** What the file chunk fallback needs from the deps of the CLI or the Action. */
export interface FileChunkDeps {
  readFile(path: string): Promise<string | null>;
  readFileStream?(path: string): Promise<AsyncIterable<string> | null>;
}

/** One chunk: what a whole-text read gave. */
export async function* oneChunk(read: () => Promise<string>): AsyncGenerator<string> {
  yield await read();
}

/** git's stdout as chunks: streamed when the deps can, else the whole text as a single chunk. */
export function gitChunks(deps: GitChunkDeps, args: string[]): AsyncIterable<string> {
  return deps.gitStream ? deps.gitStream(args) : oneChunk(() => deps.git(args));
}

/** The file as chunks: streamed when the deps can, else the whole text as a single chunk; null when it does not exist. */
export async function fileChunks(deps: FileChunkDeps, path: string): Promise<AsyncIterable<string> | null> {
  if (deps.readFileStream) return deps.readFileStream(path);
  const text = await deps.readFile(path);
  return text === null ? null : oneChunk(async () => text);
}
