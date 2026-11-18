import { describe, expect, it } from "vitest";
import type { DiffFile } from "../src/diff/unified.js";
import { detectTI10 } from "../src/signals/ti10.js";
import { MAX_CONFIG_CHARS } from "../src/testConfig/value.js";
import { measureGrowth, threadCpuMs } from "./growth.js";

// TI10 compares the scripts objects of a package.json (CORE-70): readJson, one scan for the line of each key, and one
// pass of the script scanner over each value. The value here is the worst shape the scanner has: a long run of `(`,
// `&`, `|`, escaped line feeds, escaped quotes and `--exclude` words. Each input stays under the 524,288-character
// cap, the DiffFile has no hunks so the diff-line fallback could give nothing, and each call must give a TI10 at the
// line of the `test` key, which proves the scripts-object path ran. The growth is this thread's CPU time with
// measureGrowth (growth.ts) after a warm-up call of each size, and every call is held under the 15 s ceiling.

const PATH = "package.json";
const CEILING_MS = 15_000;
const BASE = '{\n  "scripts": {\n    "test": "vitest run"\n  }\n}\n';
// In the JSON text: `\n` and `\"` are escapes, so the decoded value holds a line feed and a double quote.
const CHUNK = '(&|\\n\\" --exclude a ';

/** A package.json whose `test` script value is about `bytes` characters of the hostile shape; `test` is on line 3. */
function head(bytes: number): string {
  const prefix = '{\n  "scripts": {\n    "test": "vitest run ';
  const suffix = '"\n  }\n}\n';
  return prefix + CHUNK.repeat(Math.floor((bytes - prefix.length - suffix.length) / CHUNK.length)) + suffix;
}

const DIFF: DiffFile = { path: PATH, oldPath: PATH, status: "modified", addedLines: [3] };

function run(text: string) {
  return detectTI10([DIFF], {
    repoFiles: [PATH, "src/a.test.ts"],
    mode: "block",
    sources: {
      base: { files: [{ path: PATH, text: BASE }], dropped: [] },
      head: { files: [{ path: PATH, text }], dropped: [] },
    },
  });
}

describe("TI10: the scripts-object comparison grows less than eightfold from 100 KiB to 400 KiB", () => {
  it("each input is under the cap, gives TI10 at the test key's line, and a 4 times larger one takes less than 8 times as long", async () => {
    const small = head(100 * 1024);
    const large = head(400 * 1024);
    expect(small.length).toBeLessThan(MAX_CONFIG_CHARS);
    expect(large.length).toBeLessThan(MAX_CONFIG_CHARS);
    expect(large.length).toBeGreaterThan(MAX_CONFIG_CHARS * 0.7);

    const all: number[] = [];
    const time = (text: string) => {
      const started = threadCpuMs();
      const signals = run(text);
      all.push(threadCpuMs() - started);
      return signals;
    };
    for (const [label, text] of [
      ["small", small],
      ["large", large],
    ] as const) {
      const signals = time(text);
      expect(signals.length, `${label}: at least one TI10`).toBeGreaterThan(0);
      for (const signal of signals) {
        expect(signal.path, label).toBe(PATH);
        expect(signal.line, `${label}: the line of the test key`).toBe(3);
      }
    }

    const growth = await measureGrowth(
      () => time(small),
      () => time(large),
    );
    expect(growth.ratio, `400 KiB vs 100 KiB: ${growth.detail}`).toBeLessThan(8);
    for (const ms of all) expect(ms, "every call finishes within 15 s of CPU time").toBeLessThan(CEILING_MS);
  }, 300_000);
});
