import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 exists, so nothing that depends on it
// may run while the file loads. The moved-and-reordered control runs in the same test as the shapes that trigger.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "vitest.config.ts";
const WIDE = '["src/**/*.test.ts"]';
const NARROW = '["src/**/*.fast.test.ts"]';

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

/** check() in mode block over a modified vitest.config.ts with this base and head text; its TI09 signals. */
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

const IMPORT = 'import { defineConfig, defineProject, mergeConfig } from "vitest/config";';
const test = (include: string) => `{ test: { include: ${include}, environment: "node" } }`;

/** Each config shape, as a function of the include list it holds. */
const SHAPES: Record<string, (include: string) => string> = {
  "export default { test: … }": (include) => `export default ${test(include)};\n`,
  "export default defineConfig({ test: … })": (include) =>
    `${IMPORT}\n\nexport default defineConfig(${test(include)});\n`,
  "export default defineConfig(() => ({ test: … }))": (include) =>
    `${IMPORT}\n\nexport default defineConfig(() => (${test(include)}));\n`,
  "export default function with one top-level return": (include) =>
    `export default function config() {\n  const environment = "node";\n  return ${test(include)};\n}\n`,
  "defineConfig of an arrow with a block body and one top-level return": (include) =>
    `${IMPORT}\n\nexport default defineConfig(() => {\n  return ${test(include)};\n});\n`,
  "module.exports = { test: … }": (include) => `module.exports = ${test(include)};\n`,
  "export default defineProject({ test: … })": (include) =>
    `${IMPORT}\n\nexport default defineProject(${test(include)});\n`,
  "export default mergeConfig(base, defineConfig({ test: … }))": (include) =>
    `${IMPORT}\nimport base from "./vite.config";\n\nexport default mergeConfig(base, defineConfig(${test(include)}));\n`,
  "export default of a top-level const name": (include) =>
    `${IMPORT}\n\nconst config = defineConfig(${test(include)});\n\nexport default config;\n`,
};

describe("TI09: the config object behind each export shape", () => {
  it("AC-6: a narrowed include in each export shape gives one block TI09 for test.include, and the same array moved into a top-level const with the keys reordered gives none", async () => {
    for (const [shape, write] of Object.entries(SHAPES)) {
      const signals = await run(write(WIDE), write(NARROW));
      expect(signals, `${shape}: one TI09 signal`).toHaveLength(1);
      expect(signals[0]?.severity, shape).toBe("block");
      expect(signals[0]?.detail, shape).toContain("test.include");
    }

    const inline = `${IMPORT}\n\nexport default defineConfig({\n  test: {\n    include: ${WIDE},\n    environment: "node",\n  },\n});\n`;
    const moved = `${IMPORT}\n\nconst TEST_FILES = ${WIDE};\n\nexport default defineConfig({\n  test: {\n    environment: "node",\n    include: TEST_FILES,\n  },\n});\n`;
    expect(await run(inline, moved), "the array moved into a const and the keys reordered: no TI09").toEqual([]);
  });
});
