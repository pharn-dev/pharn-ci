import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness } from "./harness.js";

// run() is loaded inside each test body: the AC tests are written before the `accept-label` input exists, so nothing
// the build adds may run while the file loads. Each run is the harness's golden pull_request run (mode warn, no
// threshold, so it passes) with the `accept-label` input set; the fake API also answers the two sign-off reads.

/** 50 code points, 55 UTF-16 code units: length is counted in code points. */
const FIFTY = `team/${"ü".repeat(40)}${"🙂".repeat(5)}`;
const FIFTY_ONE = `zq${"x".repeat(49)}`;

async function runWith(acceptLabel: string) {
  const { run } = await import("../src/run.js");
  const h = harness({ inputs: { "accept-label": acceptLabel } });
  const signoffCalls: number[] = [];
  const eventCalls: number[] = [];
  h.deps.api = {
    ...h.deps.api,
    async getPullRequestSignoff(pullNumber: number) {
      signoffCalls.push(pullNumber);
      return { author: { login: "claude[bot]", type: "Bot" }, labels: [] };
    },
    async listIssueEvents(issueNumber: number, _page: number) {
      eventCalls.push(issueNumber);
      return { events: [], hasNext: false };
    },
  } as typeof h.deps.api;
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  const report = text === undefined ? undefined : JSON.parse(text);
  return { h, report };
}

describe("action input accept-label", () => {
  const refused: Array<[string, string]> = [
    ["51 code points", FIFTY_ONE],
    ["a tab between other characters", "zq\tzq"],
    ["a line feed between other characters", "zq\nzq"],
    ["U+0007 between other characters", "zq\u0007zq"],
  ];

  for (const [name, value] of refused) {
    it(`AC-1: a value with ${name} fails the step with one error naming accept-label, before any comment`, async () => {
      expect([...FIFTY_ONE].length).toBe(51);
      const { h } = await runWith(value);

      expect(h.failed).toHaveLength(1);
      expect(h.failed[0]).toContain("accept-label");
      expect(h.failed[0]).not.toContain(value);
      expect(h.failed[0]).not.toContain("zq");
      expect(h.posted).toEqual([]);
      expect(h.apiCalls.filter((call) => /^(create|update|delete) /.test(call))).toEqual([]);
      expect(h.written).toEqual({});
    });
  }

  it("AC-1: a 50-code-point name and a padded name are written as acceptLabel, the default spellings are not", async () => {
    expect([...FIFTY].length).toBe(50);
    expect(FIFTY.length).toBeGreaterThan(50);

    const fifty = await runWith(FIFTY);
    expect(fifty.h.failed).toEqual([]);
    expect(fifty.report.testIntegrity.acceptLabel).toBe(FIFTY);
    expectValidReport(fifty.report);

    const padded = await runWith("  team/tests-ok  ");
    expect(padded.h.failed).toEqual([]);
    expect(padded.report.testIntegrity.acceptLabel).toBe("team/tests-ok");
    expectValidReport(padded.report);

    // pharn/accepted in any case, empty and whitespace-only all mean the default label: no acceptLabel key.
    for (const value of ["pharn/accepted", "PHARN/Accepted", "", "   "]) {
      const { h, report } = await runWith(value);
      expect(h.failed, JSON.stringify(value)).toEqual([]);
      expect(report, JSON.stringify(value)).toBeDefined();
      expect("acceptLabel" in report.testIntegrity, JSON.stringify(value)).toBe(false);
      expectValidReport(report);
    }
  });
});
