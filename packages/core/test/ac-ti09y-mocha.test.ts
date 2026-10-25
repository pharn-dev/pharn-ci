import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 exists, so nothing that depends on it
// may run while the file loads. The control runs in the same test as the cases that trigger.

const REPO_ROOT = "/home/runner/work/demo/demo";

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

/** check() in mode block over one modified mocha config with this base and head text; its TI09 signals. */
async function run(path: string, base: string, head: string): Promise<Signal[]> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diffOf(path, base, head) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", path],
    testIntegrityMode: { input: "block" },
    testSources: {
      base: { files: [{ path, text: base }], dropped: [] },
      head: { files: [{ path, text: head }], dropped: [] },
    },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return (report as unknown as Report).testIntegrity.signals.filter((s) => String(s.id) === "TI09");
}

/** A `.mocharc.yml` with these top-level lines after a comment. */
const yml = (...lines: string[]) => `# mocha settings\n${lines.map((l) => `${l}\n`).join("")}`;

describe("TI09: mocha settings in .mocharc.yml and .mocharc.json", () => {
  it("AC-11: a narrowed spec, an added grep, bail and fgrep are block, a raised retries and two raised timeouts are warn, and an added reporter gives none", async () => {
    const cases: { label: string; path: string; base: string; head: string; key: string; severity: string }[] = [
      {
        label: "spec narrowed",
        path: ".mocharc.yml",
        base: yml("spec: test/**/*.spec.js"),
        head: yml("spec: test/unit/*.spec.js"),
        key: "spec",
        severity: "block",
      },
      {
        label: "grep added",
        path: ".mocharc.yml",
        base: yml("spec: test/**/*.spec.js"),
        head: yml("spec: test/**/*.spec.js", "grep: fast"),
        key: "grep",
        severity: "block",
      },
      {
        label: "bail added",
        path: ".mocharc.yml",
        base: yml("spec: test/**/*.spec.js"),
        head: yml("spec: test/**/*.spec.js", "bail: true"),
        key: "bail",
        severity: "block",
      },
      {
        label: "retries 0 → 3",
        path: ".mocharc.yml",
        base: yml("spec: test/**/*.spec.js", "retries: 0"),
        head: yml("spec: test/**/*.spec.js", "retries: 3"),
        key: "retries",
        severity: "warn",
      },
      {
        label: "timeout 2s → 30s",
        path: ".mocharc.yml",
        base: yml("spec: test/**/*.spec.js", "timeout: 2s"),
        head: yml("spec: test/**/*.spec.js", "timeout: 30s"),
        key: "timeout",
        severity: "warn",
      },
      {
        label: "timeout 2000 → 0",
        path: ".mocharc.yml",
        base: yml("spec: test/**/*.spec.js", "timeout: 2000"),
        head: yml("spec: test/**/*.spec.js", "timeout: 0"),
        key: "timeout",
        severity: "warn",
      },
      {
        label: "fgrep added",
        path: ".mocharc.json",
        base: `${JSON.stringify({ spec: "test/**/*.spec.js" }, null, 2)}\n`,
        head: `${JSON.stringify({ spec: "test/**/*.spec.js", fgrep: "smoke" }, null, 2)}\n`,
        key: "fgrep",
        severity: "block",
      },
    ];
    for (const { label, path, base, head, key, severity } of cases) {
      const signals = await run(path, base, head);
      expect(signals, `${label}: one TI09 signal`).toHaveLength(1);
      expect(signals[0]?.severity, label).toBe(severity);
      expect(signals[0]?.path).toBe(path);
      expect(signals[0]?.detail, label).toContain(key);
    }

    expect(
      await run(".mocharc.yml", yml("spec: test/**/*.spec.js"), yml("spec: test/**/*.spec.js", "reporter: dot")),
      "reporter: dot added: no TI09",
    ).toEqual([]);
  });
});
