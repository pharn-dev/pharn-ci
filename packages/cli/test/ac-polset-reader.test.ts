import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

// E3 item 23 (policy settings), AC-26. readPolicySettingsSources() is loaded inside the test body: the AC test is
// written before the build adds it to node-io, so nothing the build adds may run while this file loads. The batch git
// runner is a fake that serves `cat-file --batch-check` and `cat-file --batch` from a map of committed blobs and
// records every call.

type Sources =
  | { unavailable: string }
  | { files: { path: string; text: string }[]; dropped: { path: string; reason: string }[] };
type Reader = (
  deps: { gitBatch(args: string[], input: string): Promise<Uint8Array> },
  paths: readonly string[],
  symlinks: ReadonlySet<string> | null,
) => Promise<Sources>;

const REGULAR = ".claude/settings.json";
const LINK = "a/.claude/settings.json";
const BIG = "b/.claude/settings.json";
const UNSAFE = "c/../.claude/settings.json";
const REGULAR_TEXT = '{ "permissions": { "allow": ["Bash(ls)"] } }\n';
const BIG_TEXT = `{ "pad": "${"p".repeat(600 * 1024)}" }\n`;

/** A fake batch runner over committed blobs at HEAD; it records each call's arguments and stdin. */
function fakeGit(blobs: Record<string, string>) {
  const calls: { args: string[]; input: string }[] = [];
  const oidOf = (text: string) => createHash("sha1").update(text).digest("hex");
  const byOid = new Map(Object.values(blobs).map((text) => [oidOf(text), text]));
  const gitBatch = async (args: string[], input: string): Promise<Uint8Array> => {
    calls.push({ args: [...args], input });
    const lines = input.split("\n").filter((l) => l !== "");
    if (args.join(" ") === "cat-file --batch-check") {
      const out = lines.map((line) => {
        const path = line.replace(/^HEAD:/, "");
        const text = blobs[path];
        return text === undefined ? `${line} missing\n` : `${oidOf(text)} blob ${Buffer.byteLength(text)}\n`;
      });
      return Buffer.from(out.join(""));
    }
    if (args.join(" ") === "cat-file --batch") {
      const parts = lines.map((oid) => {
        const text = byOid.get(oid) as string;
        return Buffer.concat([
          Buffer.from(`${oid} blob ${Buffer.byteLength(text)}\n`),
          Buffer.from(text),
          Buffer.from("\n"),
        ]);
      });
      return Buffer.concat(parts);
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  return { calls, gitBatch };
}

describe("readPolicySettingsSources", () => {
  it("AC-26: no symlink set is unavailable with no git call; with one, symlinks are dropped and never requested, the rest go through one batch-check and one batch with the caps, and dropped is sorted by path", async () => {
    const nodeIo = (await import("../../node-io/src/index.js")) as unknown as { readPolicySettingsSources: Reader };
    expect(typeof nodeIo.readPolicySettingsSources, "readPolicySettingsSources is exported").toBe("function");
    const read = nodeIo.readPolicySettingsSources;
    const blobs = { [REGULAR]: REGULAR_TEXT, [LINK]: "../../elsewhere/settings.json", [BIG]: BIG_TEXT };
    const paths = [UNSAFE, BIG, REGULAR, LINK];

    const none = fakeGit(blobs);
    expect(await read({ gitBatch: none.gitBatch }, paths, null)).toEqual({
      unavailable: "git ls-tree failed, so symbolic links among the agent settings files could not be told apart",
    });
    expect(none.calls, "no git call without a symlink set").toEqual([]);

    const git = fakeGit(blobs);
    const result = await read({ gitBatch: git.gitBatch }, paths, new Set([LINK]));
    expect(result).toEqual({
      files: [{ path: REGULAR, text: REGULAR_TEXT }],
      dropped: [
        { path: LINK, reason: "symlink" },
        { path: BIG, reason: "too-large" },
        { path: UNSAFE, reason: "unsafe-path" },
      ],
    });
    expect(git.calls.map((c) => c.args.join(" "))).toEqual(["cat-file --batch-check", "cat-file --batch"]);
    const requested = git.calls[0]?.input.split("\n").filter((l) => l !== "") ?? [];
    expect([...requested].sort()).toEqual([`HEAD:${REGULAR}`, `HEAD:${BIG}`].sort());
    for (const call of git.calls) {
      expect(call.input.includes(LINK), "the symlink is never requested").toBe(false);
      expect(call.input.includes(UNSAFE), "the unsafe path never reaches git").toBe(false);
    }
    expect(git.calls[1]?.input.trim().split("\n"), "only the regular blob is read").toEqual([
      createHash("sha1").update(REGULAR_TEXT).digest("hex"),
    ]);

    // Every path a symlink: nothing reaches git.
    const links = fakeGit(blobs);
    expect(await read({ gitBatch: links.gitBatch }, [LINK], new Set([LINK]))).toEqual({
      files: [],
      dropped: [{ path: LINK, reason: "symlink" }],
    });
    expect(links.calls).toEqual([]);
  });
});
