import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { check, type Report } from "../src/index.js";
import { fixture } from "./helpers.js";
import { injectionFixture } from "./injection-fixture.js";
import { validateReport } from "./schema.js";
import { V070_CODE_TEXT, V070_INJECTION_CODES, V070_INJECTION_SCHEMA } from "./v070-codes.js";

// H4's schema and documents: report.v2.json carries the v0.7.0 code text and the optional `injection` object exactly
// once (v070-codes.ts), the object is closed and validates the reports check() makes, report.ts names the six codes,
// and README, LIMITS, THREAT-MODEL and CHANGELOG say what the scan does and misses.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

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
  it("carries the v0.7.0 code text and the injection object exactly once", () => {
    const schema = read("schema/report.v2.json");
    expect(schema.split(V070_CODE_TEXT).length - 1).toBe(1);
    expect(schema.split(V070_INJECTION_SCHEMA).length - 1).toBe(1);
    const parsed = JSON.parse(schema);
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
    for (const code of V070_INJECTION_CODES) expect(union, code).toContain(`"${code}"`);
  });
});

describe("the documents for the prompt-injection scan", () => {
  it("README has the section, the contents line and a row per code", () => {
    const readme = read("README.md");
    expect(readme).toContain("## Prompt-injection scan");
    expect(readme).toContain("- [Prompt-injection scan](#prompt-injection-scan)");
    for (const code of V070_INJECTION_CODES) expect(readme, code).toMatch(new RegExp(`^\\| \`${code}\` \\|`, "m"));
  });

  it("LIMITS says what the scan misses, THREAT-MODEL has its row and residual, CHANGELOG names the codes", () => {
    const limits = read("docs/LIMITS.md");
    expect(limits).toContain("## Prompt-injection scan");
    for (const word of ["homoglyph", "split across", "encoding", "image", "50,000", "8,000,000"]) {
      expect(limits.toLowerCase(), word).toContain(word.toLowerCase());
    }
    const threat = read("docs/THREAT-MODEL.md");
    expect(threat).toMatch(/^\| A8 {2}\| Added diff lines, read for the prompt-injection scan/m);
    expect(threat).toMatch(/^41\. \*\*The prompt-injection scan is a text filter\.\*\*/m);
    const changelog = read("CHANGELOG.md");
    // Shipped in 0.7.0: the release PR moved the Unreleased entries under `## [0.7.0] - 2026-11-08`.
    const start = changelog.indexOf("## [0.7.0] - 2026-11-08");
    expect(start, "the 0.7.0 section").toBeGreaterThanOrEqual(0);
    const unreleased = changelog.slice(start, changelog.indexOf("## [0.6.0]"));
    expect(unreleased).toContain("INJECTION_PI01");
    expect(unreleased).toContain("INJECTION_TEXT_TRUNCATED");
  });
});
