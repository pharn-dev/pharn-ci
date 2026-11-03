import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { harness } from "./harness.js";

// The backstop of the escape path: a failed load of the vendored TypeScript parser fails the step before anything is
// written, wherever the first read of the parser ends up in the test index.

const REASON = "the vendored TypeScript parser /x/typescript.js has sha256 aa, but the Action pins bb";

describe("parserLoadFailure", () => {
  it("fails the step with its text and writes no report, summary, output or comment", async () => {
    const h = harness();
    const report = await run({ ...h.deps, parserLoadFailure: () => REASON });
    expect(report).toBeUndefined();
    expect(h.failed).toEqual([`pharn-ci: ${REASON}`]);
    expect(h.written).toEqual({});
    expect(h.summary).toEqual([]);
    expect(h.outputs).toEqual({});
    expect(h.posted).toEqual([]);
    expect(h.apiCalls.filter((call) => call.startsWith("create") || call.startsWith("update"))).toEqual([]);
  });

  it("changes nothing when no load failed", async () => {
    const plain = harness();
    const checked = harness();
    const expected = await run(plain.deps);
    const actual = await run({ ...checked.deps, parserLoadFailure: () => undefined });
    expect(actual).toEqual(expected);
    expect(checked.failed).toEqual(plain.failed);
    expect(checked.written).toEqual(plain.written);
  });
});
