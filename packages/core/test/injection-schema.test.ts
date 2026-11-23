import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Report } from "../src/index.js";
import { fixture } from "./helpers.js";
import { injectionFixture } from "./injection-fixture.js";
import { validateReport } from "./schema.js";
import { check } from "./text-coverage.js";

// H4's schema: report.v2.json carries the optional `injection` object, the object is closed and validates the reports
// check() makes, and report.ts names the six codes.
// (CORE-133: the README, LIMITS, THREAT-MODEL and CHANGELOG wording checks moved out; docs-contract.test.ts checks the
// README code rows.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
/** The prompt-injection scan's message codes. */
const INJECTION_CODES = [
  "INJECTION_PI01",
  "INJECTION_PI02",
  "INJECTION_PI03",
  "INJECTION_PI04",
  "INJECTION_PI05",
  "INJECTION_TEXT_TRUNCATED",
];

function report(): Report {
  return check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: injectionFixture("trojan-source.diff.txt") + injectionFixture("pi05-trigger.diff.txt") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: ["AGENTS.md"],
  } as never);
}

describe("schema/report.v2.json for the prompt-injection scan", () => {
  it("carries the optional, closed injection object", () => {
    // CORE-132: the byte-for-byte pins of the v0.7.0 code text and the injection object's text (kept valid by the
    // schema-text helpers of the history pins) are removed; the structure is checked on the schema as it is.
    const parsed = JSON.parse(read("schema/report.v2.json"));
    expect(parsed.required).not.toContain("injection");
    expect(parsed.properties.injection.additionalProperties).toBe(false);
    expect(parsed.properties.injection.properties.signals.items.additionalProperties).toBe(false);
  });

  it("validates the reports check() makes, with a null line for a file-level finding", () => {
    const made = report();
    expect(validateReport(made), JSON.stringify(validateReport.errors)).toBe(true);
    expect(made.injection?.signals.some((s) => s.line === null)).toBe(true);
  });

  it("refuses an extra key, an empty list, an unknown severity, a bad id or line, and an empty or long detail", () => {
    const made = report();
    const signal = made.injection?.signals[0] as NonNullable<Report["injection"]>["signals"][number];
    const bad: unknown[] = [
      { signals: [signal], extra: 1 },
      { signals: [] },
      { signals: [{ ...signal, extra: 1 }] },
      { signals: [{ ...signal, severity: "pending" }] },
      { signals: [{ ...signal, id: "TI01" }] },
      { signals: [{ ...signal, line: 0 }] },
      { signals: [{ ...signal, detail: "" }] },
      { signals: [{ ...signal, detail: "x".repeat(301) }] },
    ];
    for (const injection of bad) {
      expect(validateReport({ ...made, injection }), JSON.stringify(injection)).toBe(false);
    }
  });

  it("names the six codes in report.ts", () => {
    const reportTs = read("packages/core/src/report.ts");
    const union = /export type MessageCode =([\s\S]*?);/.exec(reportTs)?.[1] ?? "";
    for (const code of INJECTION_CODES) expect(union, code).toContain(`"${code}"`);
  });
});
