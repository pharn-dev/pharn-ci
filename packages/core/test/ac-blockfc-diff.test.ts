import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before the block-mode rule for DIFF_UNAVAILABLE
// exists (review HIGH 4, block-fails-closed-unavailable), so nothing that depends on it may run while the file loads.
// The warn run is the control; the block run, in the same test, must give the error.

const CODE = "DIFF_UNAVAILABLE";

interface Message {
  code: string;
  level: string;
  text: string;
}
interface Report {
  verdict: string;
  messages: Message[];
}

async function run(mode: "warn" | "block"): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov", file: "coverage/lcov.info" },
    diff: { unavailable: "could not get the diff for base...head" },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    testIntegrityMode: { input: mode },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

const diffUnavailable = (report: Report) => report.messages.filter((m) => m.code === CODE);

describe("an unavailable diff with no threshold", () => {
  it("AC-3: mode block gives DIFF_UNAVAILABLE at level error and verdict fail, mode warn keeps it level warn with a verdict that is not fail", async () => {
    const block = await run("block");
    expect(diffUnavailable(block), `one ${CODE} message in mode block`).toHaveLength(1);
    expect(diffUnavailable(block)[0]?.level).toBe("error");
    expect(block.verdict).toBe("fail");

    const warn = await run("warn");
    expect(diffUnavailable(warn), `one ${CODE} message in mode warn`).toHaveLength(1);
    expect(diffUnavailable(warn)[0]?.level).toBe("warn");
    expect(warn.verdict).not.toBe("fail");
  });
});
