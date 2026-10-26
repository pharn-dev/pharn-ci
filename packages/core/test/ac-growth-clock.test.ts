// Acceptance tests for growth-ratio-robust-3: the shared growth helper (packages/core/test/growth.ts) measures this
// thread's CPU time by default, in samples long enough to measure, so host load does not fake growth while quadratic
// growth is still caught; and the eleven linear-time tests use it with their limits and 15 s ceilings unchanged.
// growth.ts is loaded by a dynamic import inside each test body, so this file loads before the helper exists.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TIMEOUT = 120_000;

type GrowthModule = typeof import("./growth.js");

const loadGrowth = async (): Promise<GrowthModule> => await import("./growth.js");

/** This thread's CPU time (user + system) so far, in milliseconds, read directly from Node. */
const cpuNow = (): number => {
  const { user, system } = process.threadCpuUsage();
  return (user + system) / 1000;
};

/** Spins until this thread's CPU time has advanced by `ms` milliseconds. */
const burn = (ms: number): void => {
  const start = cpuNow();
  let x = 0;
  while (cpuNow() - start < ms) x++;
  if (x < 0) throw new Error("unreachable");
};

/** Blocks this thread for `ms` milliseconds without using CPU. */
const pause = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const importsMeasureGrowthFrom = (text: string, specifier: string): boolean => {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`import\\s*\\{[^}]*\\bmeasureGrowth\\b[^}]*\\}\\s*from\\s*["']${escaped}["']`).test(text);
};

const CORE_FILES = [
  "ac-pyparity2-ti03-linear.test.ts",
  "ac-pyparity2-ti09-refusals.test.ts",
  "ac-ti0205-growth.test.ts",
  "ac-name-only-ti02-linear.test.ts",
  "ac-ti0102-linear.test.ts",
  "ac-ti06-ti12-linear.test.ts",
  "ac-signal-precision-ti06-linear.test.ts",
  "ac-signal-precision-ti11-linear.test.ts",
  "limits.test.ts",
  "ac-secrets-growth.test.ts",
];

const PY_FILE = "../../node-io/test/ac-py-index-growth.test.ts";

const CPU_CEILING_FILES = [
  "ac-ti0205-growth.test.ts",
  "ac-name-only-ti02-linear.test.ts",
  "ac-ti0102-linear.test.ts",
  "ac-ti06-ti12-linear.test.ts",
  "ac-secrets-growth.test.ts",
  "limits.test.ts",
];

describe("growth-ratio-robust-3", () => {
  it(
    "AC-1: linear CPU work measures on the cpu clock with a ratio between 2 and 8 and long samples",
    async () => {
      const { measureGrowth, MIN_SAMPLE_MS } = await loadGrowth();
      expect(MIN_SAMPLE_MS).toBe(50);
      const growth = await measureGrowth(
        () => burn(1),
        () => burn(4),
      );
      expect(growth.clock).toBe("cpu");
      expect(growth.ratio, growth.detail).toBeGreaterThan(2);
      expect(growth.ratio, growth.detail).toBeLessThan(8);
      expect(growth.smallReps, growth.detail).toBeGreaterThan(1);
      expect(growth.smallSamples.length).toBeGreaterThan(0);
      expect(growth.largeSamples.length).toBeGreaterThan(0);
      for (const ms of [...growth.smallSamples, ...growth.largeSamples]) {
        expect(ms, growth.detail).toBeGreaterThanOrEqual(MIN_SAMPLE_MS);
      }
    },
    TIMEOUT,
  );

  it(
    "AC-2: a sixteen-fold cost reads as a ratio of at least 8",
    async () => {
      const { measureGrowth } = await loadGrowth();
      const growth = await measureGrowth(
        () => burn(1),
        () => burn(16),
      );
      expect(growth.ratio, growth.detail).toBeGreaterThanOrEqual(8);
    },
    TIMEOUT,
  );

  it(
    "AC-3: pauses and CPU spikes on the large run's first three calls do not fake growth",
    async () => {
      const { measureGrowth } = await loadGrowth();
      let calls = 0;
      const large = (): void => {
        calls++;
        burn(4);
        if (calls <= 3) {
          pause(200);
          burn(100);
        }
      };
      const growth = await measureGrowth(() => burn(1), large);
      expect(calls).toBeGreaterThan(3);
      expect(growth.ratio, growth.detail).toBeLessThan(8);
    },
    TIMEOUT,
  );

  it(
    "AC-4: the wall clock measures runs that use no CPU, with a ratio between 1 and 8",
    async () => {
      const { measureGrowth } = await loadGrowth();
      const growth = await measureGrowth(
        () => pause(2),
        () => pause(8),
        { clock: "wall" },
      );
      expect(growth.clock).toBe("wall");
      expect(growth.ratio, growth.detail).toBeGreaterThan(1);
      expect(growth.ratio, growth.detail).toBeLessThan(8);
    },
    TIMEOUT,
  );

  it(
    "AC-5: the eleven linear-time tests import measureGrowth and keep their growth limit of 8",
    () => {
      for (const file of CORE_FILES) {
        const text = read(`./${file}`);
        expect(text.includes("measureGrowth("), `${file} calls measureGrowth(`).toBe(true);
        expect(importsMeasureGrowthFrom(text, "./growth.js"), `${file} imports measureGrowth from ./growth.js`).toBe(
          true,
        );
        if (file === "limits.test.ts") {
          expect(text.includes("const MAX_GROWTH = 8;"), `${file} keeps MAX_GROWTH = 8`).toBe(true);
          expect(text.includes(".toBeLessThan(MAX_GROWTH)"), `${file} asserts .toBeLessThan(MAX_GROWTH)`).toBe(true);
        } else {
          expect(text.includes(".toBeLessThan(8)"), `${file} asserts .toBeLessThan(8)`).toBe(true);
        }
      }
      const py = read(PY_FILE);
      expect(py.includes("measureGrowth("), "ac-py-index-growth calls measureGrowth(").toBe(true);
      expect(
        importsMeasureGrowthFrom(py, "../../core/test/growth.js"),
        "ac-py-index-growth imports measureGrowth from ../../core/test/growth.js",
      ).toBe(true);
      expect(py.includes("const MAX_RATIO = 8;"), "ac-py-index-growth keeps MAX_RATIO = 8").toBe(true);
      expect(py.includes(".toBeLessThan(MAX_RATIO)"), "ac-py-index-growth asserts .toBeLessThan(MAX_RATIO)").toBe(true);
    },
    TIMEOUT,
  );

  it(
    "AC-6: threadCpuMs counts CPU work but not a blocking sleep, and the six ceiling files read it",
    async () => {
      const { threadCpuMs } = await loadGrowth();
      const beforeBurn = threadCpuMs();
      burn(25);
      const burned = threadCpuMs() - beforeBurn;
      expect(burned).toBeGreaterThanOrEqual(20);
      const beforePause = threadCpuMs();
      pause(100);
      const paused = threadCpuMs() - beforePause;
      expect(paused).toBeLessThan(20);
      for (const file of CPU_CEILING_FILES) {
        const text = read(`./${file}`);
        expect(text.includes("threadCpuMs()"), `${file} contains threadCpuMs()`).toBe(true);
        expect(text.includes("15_000"), `${file} keeps its 15_000 ceiling`).toBe(true);
        expect(text.includes("performance.now("), `${file} contains no performance.now(`).toBe(false);
      }
    },
    TIMEOUT,
  );
});
