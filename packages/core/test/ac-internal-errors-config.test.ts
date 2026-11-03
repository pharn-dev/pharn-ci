import { describe, expect, it, vi } from "vitest";
import { fixture } from "./helpers.js";

// check() is loaded inside the test body: the AC test is written before the build narrows the JS config reader's
// catch, so nothing the build changes may run while the file loads. The fault is injected into a helper the JS config
// reader calls after the parse (testConfig/value.ts normalizeOpaque, reached through a value that is not a literal):
// while armed, the mock throws the armed error for any source text holding the marker identifier.

const MARKER = "pharnCiFaultMarker";

const fault = vi.hoisted(() => ({ error: null as Error | null, calls: 0 }));

vi.mock("../src/testConfig/value.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/testConfig/value.ts")>();
  return {
    ...real,
    normalizeOpaque: (source: string) => {
      if (fault.error !== null && source.includes("pharnCiFaultMarker")) {
        fault.calls++;
        throw fault.error;
      }
      return real.normalizeOpaque(source);
    },
  };
});

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "vitest.config.ts";

const BASE =
  'import { defineConfig } from "vitest/config";\n\nexport default defineConfig({\n  test: {\n    include: ["src/**/*.test.ts"],\n  },\n});\n';
const HEAD = `import { defineConfig } from "vitest/config";\nimport { ${MARKER} } from "./test-files";\n\nexport default defineConfig({\n  test: {\n    include: ${MARKER},\n  },\n});\n`;

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf(path: string, base: string, head: string): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

describe("check(): an exception from our own JS config reader", () => {
  it("AC-2: an Error and a RangeError thrown by the JS config reader for a touched vitest.config.ts each escape check() in mode block, and no report is returned", async () => {
    const { check } = await import("@pharn-ci/core");
    const input = {
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diffOf(PATH, BASE, HEAD) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: ["src/cart.ts", PATH],
      testIntegrityMode: { input: "block" },
      testSources: {
        base: { files: [{ path: PATH, text: BASE }], dropped: [] },
        head: { files: [{ path: PATH, text: HEAD }], dropped: [] },
      },
    } as unknown as Parameters<typeof check>[0];

    const injected = [
      new Error("AC-2 injected fault in the JS config reader"),
      new RangeError("AC-2 injected RangeError in the JS config reader"),
    ];
    for (const error of injected) {
      let report: unknown;
      let thrown: unknown = null;
      fault.error = error;
      fault.calls = 0;
      try {
        report = check(input);
      } catch (caught) {
        thrown = caught;
      } finally {
        fault.error = null;
      }

      expect(fault.calls, `${error.name}: the injected fault was reached through check()`).toBeGreaterThan(0);
      expect(report, `${error.name}: check() returned no report`).toBeUndefined();
      expect(thrown, `${error.name}: check() threw the reader's own error`).toBe(error);
    }
  }, 60_000);
});
