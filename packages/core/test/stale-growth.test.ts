import { describe, expect, it } from "vitest";
import { parseMakeTargets, scanInstructionTokens } from "../src/index.js";
import { measureGrowth, threadCpuMs } from "./growth.js";

// Stale instructions (Horizon 2 item H3): the instruction scanner and the Makefile reader take time linear in their
// input on shapes that would make a backtracking pattern or a nested loop quadratic. Growth is measured on this
// thread's CPU time with measureGrowth (growth.ts), after a warm-up call: 200,000 characters must take under 8 times as
// long as 50,000 (near 4 is linear, near 16 quadratic), and the slowest call must finish within 15 s. Both sizes are
// under MAX_SCAN_CHARS, so the whole text is read.

const SMALL = 50_000;
const LARGE = 200_000;

const sized = (unit: string, size: number) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);

async function linear(label: string, make: (size: number) => string, read: (text: string) => unknown) {
  const small = make(SMALL);
  const large = make(LARGE);
  read(small);
  read(large);
  let slowest = 0;
  const timed = (text: string) => () => {
    const start = threadCpuMs();
    read(text);
    slowest = Math.max(slowest, threadCpuMs() - start);
  };
  const growth = await measureGrowth(timed(small), timed(large));
  expect(slowest, `${label}: the slowest call finishes within 15 s of CPU time`).toBeLessThan(15_000);
  expect(growth.ratio, `${label}: ${growth.detail}`).toBeLessThan(8);
}

describe("stale-instruction readers run in linear time", { timeout: 300_000 }, () => {
  const shapes: [string, (size: number) => string][] = [
    ["one line of backtick runs of growing length", (size) => sized("`a ``b ```c ", size)],
    ["one line of unclosed link openers", (size) => sized("](", size)],
    ["one line of `](<` with no closing bracket", (size) => sized("](<x", size)],
    ["one line of @ words", (size) => sized("@a/b.md ", size)],
    ["one line of HTML comment openers", (size) => sized("<!--", size)],
    ["one code span holding a long command line", (size) => `\`${sized("pnpm run x && ", size - 2)}\``],
    ["one code span holding a make command with many words", (size) => `\`make ${sized("-j ", size - 7)}\``],
    ["many short lines of spans and links", (size) => sized("`src/a.ts` [x](docs/b.md)\n", size)],
    ["a fenced shell block of commands", (size) => `\`\`\`sh\n${sized("pnpm run a; make b\n", size - 10)}\n\`\`\`\n`],
    ["one line of cue-like letters and apostrophes", (size) => sized("don't'", size)],
  ];
  for (const [label, make] of shapes) {
    it(`${label}: 200,000 characters take under 8 times as long as 50,000`, async () => {
      await linear(label, make, scanInstructionTokens);
    });
  }

  it("parseMakeTargets on many target lines and one long target line: linear", async () => {
    await linear("many target lines", (size) => sized("t: d\n", size), parseMakeTargets);
    await linear("one long target line", (size) => `${sized("t ", size - 3)}: d`, parseMakeTargets);
  });
});
