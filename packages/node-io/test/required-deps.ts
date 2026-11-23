import { lstatPath, oneChunk } from "../src/index.js";

/** git's id of the blob that holds `{}`. */
const STUB_BLOB = "9e26dfeeb6e641a33dae4961196235bdb965b21b";

/**
 * A batch git runner for a repository whose every committed file holds `{}`, the smallest JSON document, so an agent
 * settings or MCP file read from it parses and sets nothing: `cat-file --batch-check` names that blob for every
 * `<rev>:<path>` line, and `cat-file --batch` gives it for each object asked for.
 */
export async function stubGitBatch(args: string[], input: string): Promise<Uint8Array> {
  const lines = input.split("\n").slice(0, -1);
  if (args.includes("--batch-check")) return Buffer.from(lines.map(() => `${STUB_BLOB} blob 2\n`).join(""));
  return Buffer.from(lines.map((oid) => `${oid} blob 2\n{}\n`).join(""));
}

/** A `fetch` with no network: every request fails as a network error. */
export async function noNetwork(): Promise<Response> {
  throw new Error("no network in this test");
}

/**
 * The deps the CLI and the Action require since CORE-143 (item 2), as minimal fakes for a test fake that had none:
 * `git` and `readFile` streamed as one chunk each, looked up on the fake when called (so a test that replaces either one
 * also replaces its stream), a batch git runner over `{}` files (`stubGitBatch`), node-io's own `lstat`, and a `fetch`
 * with no network.
 */
/** The two calls `requiredDeps` streams; a fake that spreads `requiredDeps(() => fake)` annotates its getter with it. */
export interface StreamedFake {
  git(args: string[]): Promise<string>;
  readFile(path: string): Promise<string | null>;
}

export function requiredDeps(fake: () => StreamedFake) {
  return {
    gitStream: (args: string[]) => oneChunk(() => fake().git(args)),
    readFileStream: async (path: string) => {
      const text = await fake().readFile(path);
      return text === null ? null : oneChunk(async () => text);
    },
    gitBatch: stubGitBatch,
    lstat: lstatPath,
    fetch: noNetwork,
  };
}
