import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 exists, so nothing that depends on it
// may run while the file loads. The controls run in the same test as the cases that must trigger.

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

/** check() in mode block over one modified config file with this base and head text; its TI09 signals. */
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

const json = (value: unknown) => JSON.stringify(value);

/** A vitest or vite config whose `test` key holds these values (keys omitted when undefined). */
function config(test: { include?: string[]; exclude?: string[]; coverageExclude?: string[] }): string {
  const lines = ['import { defineConfig } from "vitest/config";', "", "export default defineConfig({", "  test: {"];
  if (test.include) lines.push(`    include: ${json(test.include)},`);
  if (test.exclude) lines.push(`    exclude: ${json(test.exclude)},`);
  if (test.coverageExclude) lines.push(`    coverage: { exclude: ${json(test.coverageExclude)} },`);
  lines.push("  },", "});", "");
  return lines.join("\n");
}

const BASE_VALUES = {
  include: ["src/**/*.test.ts"],
  exclude: ["e2e/**"],
  coverageExclude: ["src/generated/**"],
};
const BASE = config(BASE_VALUES);

const workspace = (projects: string[]) =>
  [
    'import { defineWorkspace } from "vitest/config";',
    "",
    `export default defineWorkspace(${json(projects)});`,
    "",
  ].join("\n");

describe("TI09: narrowed and widened test lists", () => {
  it("AC-4: a narrowed include, a widened exclude and coverage.exclude, a widened vite exclude and a narrowed workspace each give one block TI09 with both values as JSON, and the wider, build-directory and removed-key controls give none", async () => {
    const cases: { path: string; base: string; head: string; label: string; before: unknown; after: unknown }[] = [
      {
        path: "vitest.config.ts",
        base: BASE,
        head: config({ ...BASE_VALUES, include: ["src/**/*.fast.test.ts"] }),
        label: "test.include narrowed",
        before: BASE_VALUES.include,
        after: ["src/**/*.fast.test.ts"],
      },
      {
        path: "vitest.config.ts",
        base: BASE,
        head: config({ ...BASE_VALUES, exclude: ["e2e/**", "legacy/**"] }),
        label: "test.exclude widened",
        before: BASE_VALUES.exclude,
        after: ["e2e/**", "legacy/**"],
      },
      {
        path: "vitest.config.ts",
        base: BASE,
        head: config({ ...BASE_VALUES, coverageExclude: ["src/generated/**", "src/{a,b}/**"] }),
        label: "test.coverage.exclude widened",
        before: BASE_VALUES.coverageExclude,
        after: ["src/generated/**", "src/{a,b}/**"],
      },
      {
        path: "vite.config.ts",
        base: config({ exclude: ["e2e/**"] }),
        head: config({ exclude: ["e2e/**", "legacy/**"] }),
        label: "test.exclude widened",
        before: ["e2e/**"],
        after: ["e2e/**", "legacy/**"],
      },
      {
        path: "vitest.workspace.ts",
        base: workspace(["packages/a", "packages/b"]),
        head: workspace(["packages/a"]),
        label: "projects narrowed",
        before: ["packages/a", "packages/b"],
        after: ["packages/a"],
      },
    ];
    for (const { path, base, head, label, before, after } of cases) {
      const signals = await run(path, base, head);
      expect(signals, `${path} ${label}: one TI09 signal`).toHaveLength(1);
      const signal = signals[0] as Signal;
      expect(signal.severity, `${path} ${label}`).toBe("block");
      expect(signal.path).toBe(path);
      expect(signal.detail, `${path} ${label}`).toContain(label);
      expect(signal.detail, `${path} ${label}: the base value as JSON`).toContain(json(before));
      expect(signal.detail, `${path} ${label}: the head value as JSON`).toContain(json(after));
    }

    const controls: { label: string; head: string }[] = [
      { label: "include widened to **/*.test.ts", head: config({ ...BASE_VALUES, include: ["**/*.test.ts"] }) },
      {
        label: "a second include entry",
        head: config({ ...BASE_VALUES, include: ["src/**/*.test.ts", "lib/**/*.test.ts"] }),
      },
      {
        label: "exclude gains **/node_modules/** and dist",
        head: config({ ...BASE_VALUES, exclude: ["e2e/**", "**/node_modules/**", "dist"] }),
      },
      {
        label: "coverage exclude gains **/*.d.ts",
        head: config({ ...BASE_VALUES, coverageExclude: ["src/generated/**", "**/*.d.ts"] }),
      },
      {
        label: "include key removed",
        head: config({ exclude: BASE_VALUES.exclude, coverageExclude: BASE_VALUES.coverageExclude }),
      },
    ];
    for (const { label, head } of controls) {
      expect(await run("vitest.config.ts", BASE, head), `${label}: no TI09 signal`).toEqual([]);
    }
  });
});
