// Growth measurement for the linear-time tests: how many times longer a run on a large input takes than a run on a
// small input of the same shape. Wall time on a busy host measures the host: one preemption turns a 3 ms run into
// 30 ms, and a long sample is preempted more often than a short one, so a ratio of wall times drifts up under load
// even when the code is linear. So by default the clock is this thread's CPU time (process.threadCpuUsage), which a
// preempted thread does not accrue. A sample is `reps` back-to-back runs, `reps` doubled per input until every sample
// lasts at least MIN_SAMPLE_MS, so timer resolution and scheduling cannot decide a run of a few milliseconds. Samples
// alternate small and large, and each input keeps its fastest sample: load only ever adds time. A run whose work is
// in another process (a spawned interpreter) is not on this thread's clock; it uses the wall clock, and its small
// samples are made at least three quarters as long as its large ones, so both are exposed to the same preemption.
// The limit a caller asserts is unchanged: linear work gives a ratio near 4 at four times the size, quadratic near 16.

/** The shortest a sample may last, in milliseconds of the clock in use. */
export const MIN_SAMPLE_MS = 50;
/** Samples per input, taken alternately. */
export const SAMPLES = 5;
/** The most runs one sample may hold, so a run too fast to measure cannot loop for long. */
export const MAX_REPS = 1024;

/** One input's run. It may return a promise, which is awaited inside the timed span. */
export type Run = () => unknown;

/** `cpu`: this thread's CPU time; `wall`: elapsed time, for work done outside this thread. */
export type Clock = "cpu" | "wall";

export interface Growth {
  /** The large input's per-run time over the small input's, each from its fastest sample. */
  ratio: number;
  clock: Clock;
  /** One run's time, in milliseconds: the fastest sample divided by its runs. */
  smallMs: number;
  largeMs: number;
  /** Runs per sample of each input. */
  smallReps: number;
  largeReps: number;
  /** Every kept sample's duration, in milliseconds, all its runs together. */
  smallSamples: number[];
  largeSamples: number[];
  /** A one-line account of the measurement, for an assertion message. */
  detail: string;
}

/**
 * This thread's CPU time so far, in milliseconds. The growth tests' 15 s per-run hang ceilings read it too: a runaway
 * loop burns CPU and still trips them, and a blocked wait meets the test's timeout, while preemption counts for
 * nothing.
 */
export function threadCpuMs(): number {
  const { user, system } = process.threadCpuUsage();
  return (user + system) / 1000;
}

/**
 * How the time of `large` grows over `small`. Call it after a warm-up run of each input, so the JIT compiling the code
 * under test lands on neither side; the callers check those warm-up runs' results.
 */
export async function measureGrowth(
  small: Run,
  large: Run,
  options: { clock?: Clock; samples?: number } = {},
): Promise<Growth> {
  const clock = options.clock ?? "cpu";
  const samples = options.samples ?? SAMPLES;
  const now = clock === "cpu" ? threadCpuMs : () => performance.now();
  const sample = async (run: Run, reps: number): Promise<number> => {
    const started = now();
    for (let i = 0; i < reps; i++) await run();
    return now() - started;
  };
  /** The fewest runs, a power of two, whose sample lasts at least `floor`, and that sample's duration. */
  const calibrate = async (run: Run, floor: number): Promise<[number, number]> => {
    let reps = 1;
    let ms = await sample(run, reps);
    while (ms < floor && reps < MAX_REPS) {
      reps *= 2;
      ms = await sample(run, reps);
    }
    return [reps, ms];
  };

  const [firstReps, largeFirst] = await calibrate(large, MIN_SAMPLE_MS);
  let largeReps = firstReps;
  const smallFloor = clock === "wall" ? Math.max(MIN_SAMPLE_MS, 0.75 * largeFirst) : MIN_SAMPLE_MS;
  let [smallReps] = await calibrate(small, smallFloor);
  let smalls: number[] = [];
  let larges: number[] = [];
  while (smalls.length < samples) {
    const s = await sample(small, smallReps);
    const l = await sample(large, largeReps);
    const shortSmall = s < smallFloor && smallReps < MAX_REPS;
    const shortLarge = l < MIN_SAMPLE_MS && largeReps < MAX_REPS;
    if (shortSmall || shortLarge) {
      // A calibration ran slow under load: longer samples, and the samples so far no longer compare.
      if (shortSmall) smallReps *= 2;
      if (shortLarge) largeReps *= 2;
      smalls = [];
      larges = [];
      continue;
    }
    smalls.push(s);
    larges.push(l);
  }
  const smallMs = Math.min(...smalls) / smallReps;
  const largeMs = Math.min(...larges) / largeReps;
  const list = (xs: number[]) => xs.map((x) => x.toFixed(1)).join(", ");
  return {
    ratio: largeMs / smallMs,
    clock,
    smallMs,
    largeMs,
    smallReps,
    largeReps,
    smallSamples: smalls,
    largeSamples: larges,
    detail:
      `${largeMs.toFixed(2)} ms vs ${smallMs.toFixed(2)} ms of ${clock} time per run, fastest of ${samples} samples ` +
      `(large: ${largeReps} runs per sample, ${list(larges)} ms; small: ${smallReps} runs per sample, ${list(smalls)} ms)`,
  };
}
