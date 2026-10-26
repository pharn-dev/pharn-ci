import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 22 (policy rules), AC-6. check() is loaded inside the test body: the AC test is written before the build
// adds the rules, so nothing the build adds may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";

async function run(repoFiles: string[], forbidden: string[]): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles,
    policy: {
      source: "app",
      version: 3,
      fetchedAt: "2026-10-26T12:00:00.000Z",
      document: { version: 1, setup: { forbidden_files: forbidden } },
    },
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const p08 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P08");
const name = (i: number) => `gen/f${String(i).padStart(2, "0")}.tmp`;

describe("org policy rule P08: the cap and the shown pattern", { timeout: 60_000 }, () => {
  it("AC-6: 60 matches keep 50 violations and the message counts 60, names 20, says and 40 more and 10 not listed; a 100-unit pattern is cut to 79 units and …", async () => {
    const files = Array.from({ length: 60 }, (_, i) => name(i));
    const report = await run([...files].reverse(), ["gen/*.tmp"]);
    const kept = p08(report);
    expect(kept).toHaveLength(50);
    expect(kept.map((v) => v.path)).toEqual(files.slice(0, 50));
    for (const v of kept) expect(v.severity).toBe("block");

    const messages = report.messages.filter((m) => m.code === "POLICY_P08");
    expect(messages).toHaveLength(1);
    const text = messages[0]?.text ?? "";
    expect(text).toContain("This repository tracks 60 files that match a forbidden file pattern of the org policy: ");
    expect(text.match(/gen\/f\d\d\.tmp/g)).toEqual(files.slice(0, 20));
    expect(text).toContain("and 40 more");
    expect(text.endsWith(" 10 of them are not listed in the report.")).toBe(true);

    const pattern = `long/${"x".repeat(95)}`;
    expect(pattern).toHaveLength(100);
    const long = p08(await run([pattern], [pattern]));
    expect(long).toHaveLength(1);
    expect(long[0]?.path).toBe(pattern);
    expect(long[0]?.detail).toBe(`tracked file matches forbidden pattern ${pattern.slice(0, 79)}…`);
  });
});
