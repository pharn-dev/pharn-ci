import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// main(), readDiffChunks() and check() are loaded inside each test body: the AC tests are written before TI01 exists
// and fixtures/test-integrity/TI01/ is written by the build, so nothing that depends on them may run while the file
// loads.

const ROOT = new URL("../../../", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(`fixtures/${path}`, ROOT), "utf8");

const REPO_ROOT = "/home/runner/work/demo/demo";
const SHA = "1111111111111111111111111111111111111111";
const PATH = "src/__tests__/b.test.ts";

function fakeRepo(diff: string) {
  const out: string[] = [];
  const err: string[] = [];
  const contents = new Map([[resolve(REPO_ROOT, "coverage/lcov.info"), fixture("test-files-deleted/coverage.info")]]);
  const deps = {
    cwd: REPO_ROOT,
    git: async (args: string[]) => {
      if (args.includes("ls-files")) {
        const paths = fixture("test-files-deleted/files.txt").trim().split("\n");
        return args.includes("-z") ? `${paths.join("\0")}\0` : `${paths.join("\n")}\n`;
      }
      if (args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
      if (args.includes("diff")) return diff;
      return `${SHA}\n`;
    },
    readFile: async (path: string) => contents.get(path) ?? null,
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
  };
  return { deps, stdout: () => out.join(""), stderr: () => err.join("") };
}

async function* chunksOf(text: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

describe("TI01 through the CLI and the streaming diff reader", () => {
  it("AC-10: the CLI JSON output holds the TI01 block signal for the deleted test file", async () => {
    const { main } = await import("../src/main.js");
    const repo = fakeRepo(fixture("test-integrity/TI01/block-code-stays.diff"));
    const code = await main(
      ["check", "--coverage", "coverage/lcov.info", "--format", "json", "--test-integrity", "block"],
      repo.deps as never,
    );

    expect(code).not.toBe(2);
    const report = JSON.parse(repo.stdout());
    const signals = report.testIntegrity.signals as Array<{ id: string; path: string; severity: string }>;
    expect(signals).toHaveLength(1);
    expect(signals[0]?.id).toBe("TI01");
    expect(signals[0]?.path).toBe(PATH);
    expect(signals[0]?.severity).toBe("block");
  });

  it("AC-10: the streamed diff and the whole text give the same testIntegrity block and messages", async () => {
    const { readDiffChunks, check } = await import("@pharn-ci/core");
    const text = fixture("test-integrity/TI01/block-code-stays.diff");
    const base = {
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
      testIntegrityMode: { input: "block" as const },
    };

    const parsed = await readDiffChunks(chunksOf(text, 7));
    const streamed = check({ ...base, diff: { parsed } } as Parameters<typeof check>[0]);
    const whole = check({ ...base, diff: { text } } as Parameters<typeof check>[0]);

    expect(whole.testIntegrity.signals).toHaveLength(1);
    expect(streamed.testIntegrity).toEqual(whole.testIntegrity);
    expect(streamed.messages).toEqual(whole.messages);
  });
});
