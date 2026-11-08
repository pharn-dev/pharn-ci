import { describe, expect, it } from "vitest";
import { injectionSettingsOf } from "../src/injection/policy.js";
import { detectInjection } from "../src/injection/scan.js";
import { measureGrowth, threadCpuMs } from "./growth.js";
import { addedFileDiff, parseForInjection } from "./injection-fixture.js";

// The prompt-injection scan reads untrusted lines in linear time: no regex runs over a line, phrases are found with
// indexOf, blobs by one run-length pass, invisible characters by code point. Each shape is a hostile line for one part
// of the scan, measured on this thread's CPU time with measureGrowth (growth.ts) after a checked warm-up: 400,000
// characters must take under 8 times as long as 100,000 (near 4 is linear, near 16 quadratic), and the slowest call
// must finish within 15 s of CPU time. No wall-clock budget.

const SMALL = 100_000;
const LARGE = 400_000;
const settings = injectionSettingsOf(undefined);

const repeat = (unit: string, size: number) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);

const SHAPES: [string, string, (size: number) => string, string[]][] = [
  // A phrase prefix over and over that never completes, in a Markdown file (PI02 and PI03 both read it).
  ["a phrase prefix repeated", "docs/a.md", (n) => repeat("ignore previous instruction ", n), []],
  // Comment openers with no close: every opener starts a hidden part.
  ["comment openers repeated", "docs/b.md", (n) => repeat("<!--", n), []],
  // Link-title starts with no closing parenthesis.
  ["link starts repeated", "docs/c.md", (n) => repeat('](x "', n), []],
  // Alternating blob characters and breaks, in an instruction file (PI04).
  ["short blob runs", "CLAUDE.md", (n) => repeat("a1b2c3d4e5f6 ", n), []],
  // Joiners between Latin letters: every one is checked against its neighbours (PI01).
  ["joiners between letters", "docs/d.txt", (n) => repeat(`a${String.fromCharCode(0x200d)}`, n), ["PI01"]],
  // Right-to-left marks with no right-to-left letter: the line is searched for one once.
  ["marks without RTL text", "docs/e.txt", (n) => repeat(`a${String.fromCharCode(0x200f)}`, n), ["PI01"]],
];

describe("the prompt-injection scan reads a line in linear time", { timeout: 300_000 }, () => {
  for (const [label, path, make, ids] of SHAPES) {
    it(`${label}: 400,000 characters take under 8 times as long as 100,000`, async () => {
      const small = parseForInjection(addedFileDiff(path, [make(SMALL)]));
      const large = parseForInjection(addedFileDiff(path, [make(LARGE)]));
      for (const diff of [small, large]) {
        expect(detectInjection(diff, settings).signals.map((s) => s.id)).toEqual(ids);
      }
      let slowest = 0;
      const timed = (diff: typeof small) => () => {
        const start = threadCpuMs();
        detectInjection(diff, settings);
        slowest = Math.max(slowest, threadCpuMs() - start);
      };
      const growth = await measureGrowth(timed(small), timed(large));
      expect(slowest, `${label}: the slowest call finishes within 15 s of CPU time`).toBeLessThan(15_000);
      expect(growth.ratio, `${label}: ${growth.detail}`).toBeLessThan(8);
    });
  }
});
