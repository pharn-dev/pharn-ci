import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// check() and readDiffChunks() are loaded inside the test body: the AC tests are written before the signals and the
// reader options exist, so nothing the build adds may run while the file loads.

const ROOT = new URL("../../../", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(`fixtures/${path}`, ROOT), "utf8");

const REPO_ROOT = "/home/runner/work/demo/demo";

function hunk(start: number, removed: string[], added: string[]): string[] {
  const oldPart = removed.length === 0 ? `${start - 1},0` : `${start},${removed.length}`;
  const newPart = added.length === 0 ? `${start - 1},0` : `${start},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

function edit(path: string, hunks: Array<[number, string[], string[]]>): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap(([start, removed, added]) => hunk(start, removed, added))].join("\n")}\n`;
}

async function* chunksOf(text: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

const DIFF =
  edit("config/pharn.yml", [[3, ["  threshold: 80"], ["  threshold: 70"]]]) +
  edit(".github/workflows/ci.yml", [[5, ["  pull_request:"], []]]);

const ids = (report: { testIntegrity: { signals: Array<{ id: string }> } }, id: string) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === id);

describe("TI14 and TI11 through the streaming diff reader", () => {
  it("AC-2: the streamed and the whole-text diff give the same testIntegrity block and messages, given the config path", async () => {
    const { check, readDiffChunks } = await import("@pharn-ci/core");
    const base = {
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
      testIntegrityMode: { input: "block" as const },
      configPath: "config/pharn.yml",
    };

    const parsed = await readDiffChunks(chunksOf(DIFF, 7), { configPath: "config/pharn.yml", repoRoot: REPO_ROOT });
    const streamed = check({ ...base, diff: { parsed } } as Parameters<typeof check>[0]);
    const whole = check({ ...base, diff: { text: DIFF } } as Parameters<typeof check>[0]);

    expect(ids(whole, "TI14")).toHaveLength(1);
    expect(ids(whole, "TI14")[0]).toMatchObject({ path: "config/pharn.yml", severity: "block" });
    expect(ids(whole, "TI11")).toHaveLength(1);
    expect(streamed.testIntegrity).toEqual(whole.testIntegrity);
    expect(streamed.messages).toEqual(whole.messages);

    // Without the config path the reader keeps no text for config/pharn.yml, so TI14 has nothing to read; the
    // workflow text is kept by default, so TI11 still fires.
    const without = await readDiffChunks(chunksOf(DIFF, 7));
    const partial = check({ ...base, diff: { parsed: without } } as Parameters<typeof check>[0]);
    expect(ids(partial, "TI14")).toEqual([]);
    expect(ids(partial, "TI11")).toHaveLength(1);
  });
});
