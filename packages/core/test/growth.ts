// Growth measurement for the linear-time tests: how many times longer a run on a large input takes than a run on a
// small input of the same shape. Wall time on a busy host measures the host: one preemption turns a 3 ms run into
// 30 ms, and a long sample is preempted more often than a short one, so a ratio of wall times drifts up under load
// even when the code is linear. So by default the clock is this thread's CPU time (process.threadCpuUsage), which a
// preempted thread does not accrue. A sample is `reps` back-to-back runs, `reps` set per input from timed runs so a
// sample lasts about a fifth over MIN_SAMPLE_MS and never less, so timer resolution and scheduling cannot decide a run
// of a few milliseconds. Samples alternate small and large, and each input keeps its fastest sample: load only ever
// adds time. A run whose work is
// in another process (a spawned interpreter) is not on this thread's clock; it uses the wall clock, and its small
// samples are made at least three quarters as long as its large ones, so both are exposed to the same preemption.
// The limit a caller asserts is unchanged: linear work gives a ratio near 4 at four times the size, quadratic near 16.

/** The shortest a sample may last, in milliseconds of the clock in use. */
export const MIN_SAMPLE_MS = 50;
/**
 * Samples per input, taken alternately (the first may be the one calibration ended on). Three, five before CORE-134:
 * load only ever adds time, and temporarily quadratic code still failed the callers' limit of 8 with three.
 */
export const SAMPLES = 3;
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
  /**
   * Runs per sample so a sample lasts at least `floor`, and that sample's duration: estimated from one run to last a
   * fifth over `floor`, then doubled while a sample still falls short. A slow first run only makes the estimate low,
   * which the doubling corrects; reps never exceed MAX_REPS.
   */
  const calibrate = async (run: Run, floor: number): Promise<[number, number]> => {
    const once = await sample(run, 1);
    if (once >= floor) return [1, once];
    let reps = Math.min(MAX_REPS, Math.max(2, Math.ceil((1.2 * floor) / Math.max(once, 0.001))));
    let ms = await sample(run, reps);
    while (ms < floor && reps < MAX_REPS) {
      reps = Math.min(MAX_REPS, reps * 2);
      ms = await sample(run, reps);
    }
    return [reps, ms];
  };

  const [firstReps, largeFirst] = await calibrate(large, MIN_SAMPLE_MS);
  let largeReps = firstReps;
  const smallFloor = clock === "wall" ? Math.max(MIN_SAMPLE_MS, 0.75 * largeFirst) : MIN_SAMPLE_MS;
  let [smallReps, smallFirst] = await calibrate(small, smallFloor);
  // A calibration that ended on a sample of many runs gives that input its first sample. One that ended on a single run
  // does not: that run may be the first of a few slow ones (a pause, a compile), and only a later clean run that falls
  // short of the floor exposes them, so the samples kept after it must not all come from that slow start.
  const reuse = smallReps > 1 && largeReps > 1;
  let smalls: number[] = reuse ? [smallFirst] : [];
  let larges: number[] = reuse ? [largeFirst] : [];
  while (smalls.length < samples) {
    const s = await sample(small, smallReps);
    const l = await sample(large, largeReps);
    const shortSmall = s < smallFloor && smallReps < MAX_REPS;
    const shortLarge = l < MIN_SAMPLE_MS && largeReps < MAX_REPS;
    if (shortSmall || shortLarge) {
      // A calibration ran slow under load: longer samples, and the samples so far no longer compare.
      if (shortSmall) smallReps = Math.min(MAX_REPS, smallReps * 2);
      if (shortLarge) largeReps = Math.min(MAX_REPS, largeReps * 2);
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
