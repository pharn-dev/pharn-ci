import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 exists, so nothing that depends on it
// may run while the file loads. The first config loosens 25 keys: 21 block (four thresholds lowered, 100 and perFile
// turned off, autoUpdate turned on, ten per-glob thresholds lowered, include narrowed, exclude widened,
// passWithNoTests and allowOnly turned on) and 4 warn (retry, testTimeout and hookTimeout raised, and
// coverage.exclude becoming an imported name that cannot be compared).

const REPO_ROOT = "/home/runner/work/demo/demo";
const VITEST = "vitest.config.ts";

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
interface Pair {
  path: string;
  base: string;
  head: string;
}

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf({ path, base, head }: Pair): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

async function run(pairs: Pair[]): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const side = (key: "base" | "head") => pairs.map((p) => ({ path: p.path, text: p[key] })).sort(byPath);
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: pairs.map(diffOf).join("") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...pairs.map((p) => p.path), "src/cart.ts"].sort(),
    testIntegrityMode: { input: "block" },
    testSources: { base: { files: side("base"), dropped: [] }, head: { files: side("head"), dropped: [] } },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

const ti09 = (report: Report) => report.testIntegrity.signals.filter((s) => String(s.id) === "TI09");
const ti09Messages = (report: Report) => report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI09");

const GLOBS = Array.from({ length: 10 }, (_, i) => `src/g${i}/**`);

function loosened(head: boolean): string {
  const n = (base: number, lowered: number) => (head ? lowered : base);
  return [
    'import { defineConfig } from "vitest/config";',
    'import { sharedExcludes } from "./vitest.shared";',
    "",
    "export default defineConfig({",
    "  test: {",
    `    include: ${head ? '["src/**/*.fast.test.ts"]' : '["src/**/*.test.ts"]'},`,
    `    exclude: ${head ? '["e2e/**", "legacy/**"]' : '["e2e/**"]'},`,
    ...(head ? ["    passWithNoTests: true,", "    allowOnly: true,"] : []),
    `    retry: ${n(0, 3)},`,
    `    testTimeout: ${n(5000, 60000)},`,
    `    hookTimeout: ${n(10000, 100000)},`,
    "    coverage: {",
    `      exclude: ${head ? "sharedExcludes" : '["src/generated/**"]'},`,
    "      thresholds: {",
    `        lines: ${n(90, 10)},`,
    `        functions: ${n(90, 10)},`,
    `        branches: ${n(90, 10)},`,
    `        statements: ${n(90, 10)},`,
    `        100: ${!head},`,
    `        perFile: ${!head},`,
    `        autoUpdate: ${head},`,
    ...GLOBS.map((glob) => `        "${glob}": { lines: ${n(90, 10)} },`),
    "      },",
    "    },",
    "  },",
    "});",
    "",
  ].join("\n");
}

const vitestThreshold = (lines: number) =>
  `import { defineConfig } from "vitest/config";\n\nexport default defineConfig({\n  test: {\n    coverage: { thresholds: { lines: ${lines} } },\n  },\n});\n`;
const pkg = (jest: unknown) => `${JSON.stringify({ name: "demo", jest }, null, 2)}\n`;

/** Sort key of the report's signal order: path, then line with null first, then detail. */
function inOrder(a: Signal, b: Signal): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.line !== b.line) return a.line === null ? -1 : b.line === null ? 1 : a.line - b.line;
  return a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0;
}

describe("TI09: the shared cap of 20 findings per file and the message", () => {
  it("AC-16: 25 loosened keys in one file list 20 block TI09 and count 5 not listed in an error message, and one loosened key in each of three files sorts by path, line and detail and names all three paths", async () => {
    const capped = await run([{ path: VITEST, base: loosened(false), head: loosened(true) }]);
    const listed = ti09(capped);
    expect(listed, "20 TI09 signals").toHaveLength(20);
    expect(listed.every((s) => s.path === VITEST)).toBe(true);
    expect(
      listed.map((s) => s.severity),
      "every listed signal is block: 21 block findings come before the 4 warn ones",
    ).toEqual(Array(20).fill("block"));
    const cappedMessages = ti09Messages(capped);
    expect(cappedMessages, "one TEST_INTEGRITY_TI09 message").toHaveLength(1);
    expect(cappedMessages[0]?.level).toBe("error");
    expect(cappedMessages[0]?.text, "the 5 omitted findings are counted").toContain(
      `Not listed: 5 more in \`${VITEST}\``,
    );

    const three = await run([
      { path: VITEST, base: vitestThreshold(90), head: vitestThreshold(70) },
      {
        path: "package.json",
        base: pkg({ testEnvironment: "node" }),
        head: pkg({ testEnvironment: "node", passWithNoTests: true }),
      },
      { path: "pytest.ini", base: "[pytest]\naddopts = -q\n", head: "[pytest]\naddopts = -q -x\n" },
    ]);
    const signals = ti09(three);
    expect(
      signals.map((s) => s.path),
      "one signal per file, sorted by path",
    ).toEqual(["package.json", "pytest.ini", VITEST]);
    expect(signals, "sorted by path, then line, then detail").toEqual([...signals].sort(inOrder));
    const messages = ti09Messages(three);
    expect(messages, "one TEST_INTEGRITY_TI09 message").toHaveLength(1);
    for (const path of ["package.json", "pytest.ini", VITEST]) {
      expect(messages[0]?.text, `names ${path}`).toContain(path);
    }
  });
});
