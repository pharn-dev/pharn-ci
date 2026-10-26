import type { TestSourceObject } from "@pharn-ci/core";

/** The one git call the blob helpers make: bytes out for a call that is given stdin. */
export interface GitBatchDeps {
  gitBatch(args: string[], input: string): Promise<Uint8Array>;
}

/** A full object id: 40 hex digits (SHA-1) or 64 (SHA-256). */
export const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
/** A `--batch-check` result line and a `--batch` header line: `<oid> <type> <size>`. */
const OBJECT_LINE = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) (\S+) (\d+)$/;
const MAX_REASON_CHARS = 300;

/** A step failed; the message is the reason the sources are unavailable. */
export class StepFailed extends Error {}

/** The first line of an error's message, cut to a bounded length. */
export const firstLine = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).trim().split("\n")[0]?.slice(0, MAX_REASON_CHARS) ?? "";

/**
 * `git cat-file --batch-check` for `<revision>:<path>` lines, where the revision is an object id or a revision name
 * such as `HEAD`: one result per line, in order; null when absent.
 */
export async function batchCheck(
  deps: GitBatchDeps,
  requests: readonly { oid: string; path: string }[],
): Promise<({ oid: string; object: TestSourceObject } | null)[]> {
  if (requests.length === 0) return [];
  const input = requests.map((r) => `${r.oid}:${r.path}\n`).join("");
  let out: Uint8Array;
  try {
    out = await deps.gitBatch(["cat-file", "--batch-check"], input);
  } catch (err) {
    throw new StepFailed(`git cat-file --batch-check failed: ${firstLine(err)}`);
  }
  const lines = Buffer.from(out).toString("utf8").split("\n");
  if (lines.pop() !== "" || lines.length !== requests.length) {
    throw new StepFailed("git cat-file --batch-check output could not be read");
  }
  return lines.map((line) => {
    const match = OBJECT_LINE.exec(line);
    return match === null
      ? null
      : { oid: match[1] as string, object: { type: match[2] as string, size: Number(match[3]) } };
  });
}

/** `git cat-file --batch` for blob ids: the bytes of each, by id. */
export async function batchRead(deps: GitBatchDeps, oids: readonly string[]): Promise<Map<string, Uint8Array>> {
  const contents = new Map<string, Uint8Array>();
  if (oids.length === 0) return contents;
  let out: Uint8Array;
  try {
    out = await deps.gitBatch(["cat-file", "--batch"], oids.map((oid) => `${oid}\n`).join(""));
  } catch (err) {
    throw new StepFailed(`git cat-file --batch failed: ${firstLine(err)}`);
  }
  const unreadable = () => new StepFailed("git cat-file --batch output could not be read");
  let at = 0;
  for (const oid of oids) {
    const end = out.indexOf(0x0a, at);
    if (end === -1) throw unreadable();
    const header = OBJECT_LINE.exec(Buffer.from(out.subarray(at, end)).toString("utf8"));
    if (header === null || header[1] !== oid || header[2] !== "blob") throw unreadable();
    const size = Number(header[3]);
    const start = end + 1;
    if (start + size >= out.length || out[start + size] !== 0x0a) throw unreadable();
    contents.set(oid, out.subarray(start, start + size));
    at = start + size + 1;
  }
  if (at !== out.length) throw unreadable();
  return contents;
}
