import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// parseUnifiedDiff(), check() and the fixtures are loaded inside each test body: the AC tests are written before the
// binary flag, the binary-covered-file warning and fixtures/gate-tamper/ exist, so nothing that depends on them may
// run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

type Message = { level: string; code: string; text: string };

const lines = (path: string) => fixture(path).trim().split("\n");
const withCode = (messages: readonly Message[], code: string) => messages.filter((message) => message.code === code);

async function runCheck(diff: string) {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage: { text: fixture("gate-tamper/coverage.info"), format: "lcov" as const },
    diff: { text: fixture(`gate-tamper/${diff}`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: lines("gate-tamper/files.txt"),
  };
  return check(input as Parameters<typeof check>[0]);
}

describe("binary diff entries for covered files", () => {
  it("AC-3: parseUnifiedDiff sets binary: true on exactly the binary entries and leaves it off every other entry", async () => {
    const { parseUnifiedDiff } = await import("../src/diff/unified.js");
    const files = parseUnifiedDiff(fixture("gate-tamper/binary.diff"));
    expect(files.map((file) => file.path)).toEqual(["src/x.ts", "src/y.ts", "assets/logo.png", "src/app.ts"]);
    for (const file of files) {
      const isBinary = file.path !== "src/app.ts";
      expect(Object.hasOwn(file, "binary"), file.path).toBe(isBinary);
      if (isBinary) expect((file as { binary?: unknown }).binary, file.path).toBe(true);
    }
    expect(files.find((file) => file.path === "src/app.ts")?.addedLines).toEqual([2]);
  });

  it("AC-3: check() warns once, naming the covered binary paths and not the uncovered one", async () => {
    const report = await runCheck("binary.diff");
    expectValidReport(report);
    const warnings = withCode(report.messages, "DIFF_BINARY_COVERED_FILE");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.level).toBe("warn");
    expect(warnings[0]?.text).toContain("src/x.ts");
    expect(warnings[0]?.text).toContain("src/y.ts");
    expect(warnings[0]?.text).not.toContain("assets/logo.png");

    const untouched = await runCheck("untouched.diff");
    expectValidReport(untouched);
    expect(withCode(untouched.messages, "DIFF_BINARY_COVERED_FILE")).toEqual([]);
  });
});
