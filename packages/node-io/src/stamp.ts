import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";

/** What a file looked like at one moment: enough to tell, later, whether anything wrote it since. */
export interface FileStamp {
  /** The modification time in nanoseconds, as a decimal string (as precise as the file system keeps it). */
  mtimeNs: string;
  /** The size in bytes. */
  size: number;
  /** The sha256 of the bytes, in hex; null when the file is larger than the hash budget, so it was not read. */
  sha256: string | null;
}

/** An error code that means the path is not there (any more). */
function isMissing(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * The stamp of a regular file, without following a symbolic link: its modification time and the sha256 of its bytes
 * (read as a stream, never held whole). A file larger than `maxHashBytes` bytes, or one that grows past it while it is
 * read, gets `sha256: null`. Resolves null when the path does not exist or is not a regular file; any other failure
 * rejects. Used by `pharn-ci test` to tell a JUnit file the wrapped command wrote from one an earlier run left.
 */
export async function fileStamp(path: string, maxHashBytes: number): Promise<FileStamp | null> {
  let stat: Awaited<ReturnType<typeof lstat>> & { mtimeNs: bigint; size: bigint };
  try {
    stat = await lstat(path, { bigint: true });
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
  if (!stat.isFile()) return null;
  const mtimeNs = stat.mtimeNs.toString();
  const size = Number(stat.size);
  if (stat.size > BigInt(maxHashBytes)) return { mtimeNs, size, sha256: null };
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of createReadStream(path)) {
      const buffer = chunk as Buffer;
      bytes += buffer.length;
      if (bytes > maxHashBytes) return { mtimeNs, size, sha256: null };
      hash.update(buffer);
    }
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
  return { mtimeNs, size, sha256: hash.digest("hex") };
}
