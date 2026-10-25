import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { harness } from "./harness.js";

// run() is loaded inside the test body: the AC tests are written before the accept label exists, so nothing the build
// adds may run while the file loads. The harness run is the golden pull_request run (the fixtures/golden inputs,
// threshold 80), which fails only on its diff coverage.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
/** sha256 of fixtures/golden/report.json at the base commit a1089fd. */
const GOLDEN_AT_BASE = "0e2fc1bc1779fadebf210df5f97fdd3a0332ffbc95819c07d81efcaabfd04d6b";
/** The two existing assertions that compare a whole default Action report with the golden report. */
const GOLDEN_ASSERTIONS: Array<[string, string]> = [
  [
    "packages/action/test/ac-stream-action.test.ts",
    'expect(action.report()).toEqual(JSON.parse(fixture("golden/report.json")));',
  ],
  [
    "packages/cli/test/ac-stream-adapters.test.ts",
    'expect(action.report()).toEqual(JSON.parse(fixture("golden/report.json")));',
  ],
];

async function goldenRun(inputs: Record<string, string>) {
  const { run } = await import("../src/run.js");
  const h = harness({ inputs: { threshold: "80", ...inputs } });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  expect(text, "report.json was written").toBeDefined();
  return { h, report: JSON.parse(text as string) };
}

describe("a default Action run's report is the golden report", () => {
  it("AC-13: with accept-label unset the report has no acceptLabel and equals fixtures/golden/report.json", async () => {
    const golden = readFileSync(new URL("fixtures/golden/report.json", ROOT));
    expect(createHash("sha256").update(golden).digest("hex")).toBe(GOLDEN_AT_BASE);

    const unset = await goldenRun({});
    expect("acceptLabel" in unset.report.testIntegrity).toBe(false);
    expect(unset.report).toEqual(JSON.parse(golden.toString("utf8")));
    expect(unset.h.failed.filter((message) => !message.includes("below the threshold"))).toEqual([]);

    // Control: the same run with a configured label carries it, and differs from the golden report by that key only.
    const configured = await goldenRun({ "accept-label": "team/tests-ok" });
    expect(configured.report.testIntegrity.acceptLabel).toBe("team/tests-ok");
    const { acceptLabel: _label, ...rest } = configured.report.testIntegrity;
    expect({ ...configured.report, testIntegrity: rest }).toEqual(JSON.parse(golden.toString("utf8")));

    // The two existing golden assertions are still there, as they were.
    for (const [file, assertion] of GOLDEN_ASSERTIONS) expect(read(file), file).toContain(assertion);
  });
});
