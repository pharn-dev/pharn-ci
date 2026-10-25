import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 exists, so nothing that depends on it
// may run while the file loads. The removed and newly added jest keys run in the same test as the cases that trigger.

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

/** A `--unified=0` diff of `path`: every base line replaced by every head line, or an added file without a base. */
function diffOf(path: string, base: string | undefined, head: string): string {
  const added = linesOf(head).map((line) => `+${line}`);
  if (base === undefined) {
    const lines = [`diff --git a/${path} b/${path}`, "new file mode 100644", "index 0000000..3333333", "--- /dev/null"];
    return `${[...lines, `+++ b/${path}`, `@@ -0,0 +1,${added.length} @@`, ...added].join("\n")}\n`;
  }
  const removed = linesOf(base).map((line) => `-${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

/** check() in mode block over one touched file with this base (absent when added) and head text; its TI09 signals. */
async function run(path: string, base: string | undefined, head: string): Promise<Signal[]> {
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
      base: { files: base === undefined ? [] : [{ path, text: base }], dropped: [] },
      head: { files: [{ path, text: head }], dropped: [] },
    },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return (report as unknown as Report).testIntegrity.signals.filter((s) => String(s.id) === "TI09");
}

const pkg = (jest?: unknown) =>
  `${JSON.stringify({ name: "demo", version: "1.0.0", ...(jest === undefined ? {} : { jest }) }, null, 2)}\n`;

describe("TI09: jest settings in package.json and an added jest.config.js", () => {
  it("AC-8: lowered global and per-path thresholds and an added passWithNoTests give three block TI09 with line null, an added jest.config.js with passWithNoTests gives one, and a removed or newly added jest key gives none", async () => {
    const base = pkg({ coverageThreshold: { global: { lines: 90 }, "./src/core/": { branches: 100 } } });
    const head = pkg({
      coverageThreshold: { global: { lines: 80 }, "./src/core/": { branches: 90 } },
      passWithNoTests: true,
    });
    const signals = await run("package.json", base, head);
    expect(signals, "three TI09 signals").toHaveLength(3);
    for (const signal of signals) {
      expect(signal.severity, signal.detail).toBe("block");
      expect(signal.path).toBe("package.json");
      expect(signal.line, `${signal.detail}: a JSON finding has line null`).toBeNull();
    }
    const details = signals.map((s) => s.detail);
    expect(details.some((d) => d.includes("jest.coverageThreshold.global.lines"))).toBe(true);
    expect(
      details.some((d) => d.includes("jest.coverageThreshold") && d.includes("./src/core/") && d.includes("branches")),
      "the per-path branches key",
    ).toBe(true);
    expect(details.some((d) => d.includes("jest.passWithNoTests"))).toBe(true);

    const added = await run("jest.config.js", undefined, "module.exports = {\n  passWithNoTests: true,\n};\n");
    expect(added, "added jest.config.js: one TI09 signal").toHaveLength(1);
    expect(added[0]?.severity).toBe("block");
    expect(added[0]?.path).toBe("jest.config.js");
    expect(added[0]?.detail).toContain("passWithNoTests");

    expect(await run("package.json", base, pkg()), "the jest key removed: no TI09").toEqual([]);
    expect(
      await run("package.json", pkg(), pkg({ testEnvironment: "node" })),
      "a jest key added with only testEnvironment: no TI09",
    ).toEqual([]);
  });
});
