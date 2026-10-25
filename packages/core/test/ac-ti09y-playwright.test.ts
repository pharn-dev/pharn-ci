import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 exists, so nothing that depends on it
// may run while the file loads. The control runs in the same test as the cases that trigger.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "playwright.config.ts";

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Report {
  testIntegrity: { signals: Signal[] };
  messages: { code: string; level: string; text: string }[];
}

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf(path: string, base: string, head: string): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

/** check() in mode block over a modified playwright.config.ts with this base and head text; its TI09 signals. */
async function run(base: string, head: string): Promise<Signal[]> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diffOf(PATH, base, head) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", PATH],
    testIntegrityMode: { input: "block" },
    testSources: {
      base: { files: [{ path: PATH, text: base }], dropped: [] },
      head: { files: [{ path: PATH, text: head }], dropped: [] },
    },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return (report as unknown as Report).testIntegrity.signals.filter((s) => String(s.id) === "TI09");
}

interface Settings {
  forbidOnly: string;
  retries: string;
  testIgnore: string;
  testMatch: string;
  grep?: string;
  baseURL: string;
  projectRetries: string;
}
const BASE: Settings = {
  forbidOnly: "!!process.env.CI",
  retries: "0",
  testIgnore: '["**/fixtures/**"]',
  testMatch: '["**/*.spec.ts", "**/*.e2e.ts"]',
  baseURL: '"http://localhost:3000"',
  projectRetries: "0",
};

/** A playwright config with these top-level settings and one project entry. */
function config(s: Settings): string {
  return [
    'import { defineConfig, devices } from "@playwright/test";',
    "",
    "export default defineConfig({",
    '  testDir: "./e2e",',
    `  forbidOnly: ${s.forbidOnly},`,
    `  retries: ${s.retries},`,
    `  testIgnore: ${s.testIgnore},`,
    `  testMatch: ${s.testMatch},`,
    ...(s.grep === undefined ? [] : [`  grep: ${s.grep},`]),
    `  use: { baseURL: ${s.baseURL} },`,
    `  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] }, retries: ${s.projectRetries} }],`,
    "});",
    "",
  ].join("\n");
}

describe("TI09: playwright top-level settings", () => {
  it("AC-10: forbidOnly turned off, a widened testIgnore, an added static or computed grep and a narrowed testMatch are block, a raised top-level retries is warn, and baseURL with a per-project retries gives none", async () => {
    const cases: { label: string; head: Settings; key: string; severity: string }[] = [
      { label: "forbidOnly → false", head: { ...BASE, forbidOnly: "false" }, key: "forbidOnly", severity: "block" },
      {
        label: "testIgnore gains **/slow/**",
        head: { ...BASE, testIgnore: '["**/fixtures/**", "**/slow/**"]' },
        key: "testIgnore",
        severity: "block",
      },
      { label: 'grep: "@smoke" added', head: { ...BASE, grep: '"@smoke"' }, key: "grep", severity: "block" },
      {
        label: "grep: process.env.GREP added",
        head: { ...BASE, grep: "process.env.GREP" },
        key: "grep",
        severity: "block",
      },
      {
        label: "testMatch narrowed",
        head: { ...BASE, testMatch: '["**/*.spec.ts"]' },
        key: "testMatch",
        severity: "block",
      },
      { label: "retries 0 → 2", head: { ...BASE, retries: "2" }, key: "retries", severity: "warn" },
    ];
    const base = config(BASE);
    for (const { label, head, key, severity } of cases) {
      const signals = await run(base, config(head));
      expect(signals, `${label}: one TI09 signal`).toHaveLength(1);
      expect(signals[0]?.severity, label).toBe(severity);
      expect(signals[0]?.path).toBe(PATH);
      expect(signals[0]?.detail, label).toContain(key);
      if (label.includes("process.env.GREP")) {
        expect(signals[0]?.detail, label).toContain("added or changed");
        expect(signals[0]?.detail, label).not.toContain("cannot be compared");
      }
    }

    const control = config({ ...BASE, baseURL: '"http://localhost:4000"', projectRetries: "2" });
    expect(await run(base, control), "use.baseURL and a per-project retries: no TI09").toEqual([]);
  });
});
