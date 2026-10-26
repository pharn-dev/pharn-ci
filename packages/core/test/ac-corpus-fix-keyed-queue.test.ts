import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// corpus-run-errors-3: scripts/corpus-run.mjs exports `createKeyedQueue()`, whose `run(key, fn)` runs calls with the
// same key one after another in call order and calls with different keys concurrently; a rejecting `fn` does not
// block the key's next call, and `run` settles with `fn`'s own outcome. Start and end are recorded on a logical clock
// (a counter), so the overlap checks do not depend on wall-clock timing. The module is imported inside each test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

type Queue = { run: <T>(key: string, fn: () => Promise<T>) => Promise<T> };
type Run = { createKeyedQueue: () => Queue };

const load = async (): Promise<Run> =>
  (await import(pathToFileURL(join(ROOT, "scripts/corpus-run.mjs")).href)) as unknown as Run;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type Span = { start: number; end: number };
const overlaps = (x: Span, y: Span): boolean => x.start < y.end && y.start < x.end;

describe("corpus-run createKeyedQueue", () => {
  it("AC-7: serializes calls of one key in call order, runs other keys concurrently, survives a rejection", async () => {
    const { createKeyedQueue } = await load();
    const queue = createKeyedQueue();

    let clock = 0;
    const spans = new Map<string, Span>();
    const order: string[] = [];
    const failure = new Error("a2 failed");

    const job =
      <T>(name: string, ms: number, outcome: () => T) =>
      async (): Promise<T> => {
        const span: Span = { start: clock++, end: Number.POSITIVE_INFINITY };
        spans.set(name, span);
        order.push(name);
        await delay(ms);
        span.end = clock++;
        return outcome();
      };

    const settled = await Promise.allSettled([
      queue.run(
        "a",
        job("a1", 30, () => "a1 value"),
      ),
      queue.run(
        "a",
        job("a2", 10, (): string => {
          throw failure;
        }),
      ),
      queue.run(
        "a",
        job("a3", 10, () => "a3 value"),
      ),
      queue.run(
        "b",
        job("b1", 20, () => "b1 value"),
      ),
    ]);

    expect(settled).toEqual([
      { status: "fulfilled", value: "a1 value" },
      { status: "rejected", reason: failure },
      { status: "fulfilled", value: "a3 value" },
      { status: "fulfilled", value: "b1 value" },
    ]);
    expect((settled[1] as PromiseRejectedResult).reason).toBe(failure);

    const a1 = spans.get("a1") as Span;
    const a2 = spans.get("a2") as Span;
    const a3 = spans.get("a3") as Span;
    const b1 = spans.get("b1") as Span;
    for (const span of [a1, a2, a3, b1]) expect(span).toBeDefined();

    // The three `a` functions start in call order and never overlap; the third runs after the second rejected.
    expect(order.filter((name) => name.startsWith("a"))).toEqual(["a1", "a2", "a3"]);
    expect(a1.end).toBeLessThan(a2.start);
    expect(a2.end).toBeLessThan(a3.start);
    expect(overlaps(a1, a2) || overlaps(a2, a3) || overlaps(a1, a3)).toBe(false);

    // The `b` function overlaps an `a` function.
    expect([a1, a2, a3].some((a) => overlaps(a, b1))).toBe(true);
  }, 20_000);
});
