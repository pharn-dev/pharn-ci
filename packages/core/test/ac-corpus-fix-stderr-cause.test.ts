import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// corpus-run-errors-3: scripts/corpus-run.mjs exports `stderrCause(text)`, which picks the cause line of a git step's
// stderr: lines split on CRLF, LF and lone CR, control characters dropped (a tab becomes a space), trimmed; the LAST
// `fatal:` / `error:` line wins, else the LAST non-empty line that is not a git progress line, else `undefined`.
// The module is imported inside each test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const KEPT = /^[\x20-\x7e\xa0-￿]*$/;

type Run = { stderrCause: (text: string) => string | undefined };

const load = async (): Promise<Run> =>
  (await import(pathToFileURL(join(ROOT, "scripts/corpus-run.mjs")).href)) as unknown as Run;

describe("corpus-run stderrCause", () => {
  it("AC-1: returns the last fatal: or error: line of a git step's stderr", async () => {
    const { stderrCause } = await load();
    expect(
      stderrCause(
        "Preparing worktree (detached HEAD 1a2b3c4)\nfatal: '/c/.worktrees/a__b-7' is a missing but locked worktree\n",
      ),
    ).toBe("fatal: '/c/.worktrees/a__b-7' is a missing but locked worktree");
    expect(stderrCause("error: first\nfatal: second\nhint: try again\n")).toBe("fatal: second");
  });

  it("AC-2: skips git progress lines and blank text, else returns the last non-progress line", async () => {
    const { stderrCause } = await load();
    expect(stderrCause("Preparing worktree (detached HEAD 1a2b3c4)\nHEAD is now at 1a2b3c4 subject\n")).toBe(undefined);
    expect(
      stderrCause(
        "Cloning into '/c/a__b'...\nremote: Enumerating objects: 5, done.\nremote: Counting objects: 100% (5/5), done.\nremote: Compressing objects: 100% (3/3), done.\nremote: Total 5 (delta 0)\nReceiving objects: 100% (5/5)\nResolving deltas: 100% (1/1)\nUnpacking objects: 100% (5/5)\n",
      ),
    ).toBe(undefined);
    expect(stderrCause("")).toBe(undefined);
    expect(stderrCause("  \n\t\n")).toBe(undefined);
    expect(stderrCause("Updating files: 100% (3/3), done.\nwarning: one\nwarning: two\n")).toBe("warning: two");
  });

  it("AC-3: splits on lone CR and drops control characters from the returned line", async () => {
    const { stderrCause } = await load();
    const results = [
      stderrCause("Updating files:  50% (1/2)\rUpdating files: 100% (2/2), done.\r\nfatal: lone cr\r\n"),
      stderrCause("fatal:\tbad\x00\x07 thing\x7f\x9b\n"),
      stderrCause("\x1b[31mfatal: colored\x1b[0m\n"),
    ];
    expect(results).toEqual(["fatal: lone cr", "fatal: bad thing", "[31mfatal: colored[0m"]);
    for (const result of results) {
      expect(typeof result).toBe("string");
      expect(KEPT.test(result as string)).toBe(true);
    }
  });
});
