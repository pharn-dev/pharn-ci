import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 exists, so nothing that depends on it
// may run while the file loads. The identical-spread control runs in the same test as the cases that trigger.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "vitest.config.ts";

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

const IMPORT = 'import { configDefaults, defineConfig, mergeConfig } from "vitest/config";';
const BASE = `${IMPORT}\n\nexport default defineConfig({\n  test: {\n    include: ["src/**/*.test.ts"],\n  },\n});\n`;

describe("TI09: values that are not literals", () => {
  it("AC-7: an imported include, a spread test object and a mergeConfig head without test each give one warn cannot-be-compared TI09, an identical opaque spread gives none, and an unknown default-export call gives one warn (config) TI09", async () => {
    const heads: { label: string; head: string; names?: string }[] = [
      {
        label: "include from an import",
        head: `${IMPORT}\nimport { files } from "./test-files";\n\nexport default defineConfig({\n  test: {\n    include: files,\n  },\n});\n`,
        names: "files",
      },
      {
        label: "a spread test object without include",
        head: `${IMPORT}\nimport { shared } from "./vitest.shared";\n\nexport default defineConfig({\n  test: {\n    ...shared,\n  },\n});\n`,
      },
      {
        label: "mergeConfig without a test key",
        head: `${IMPORT}\nimport shared from "./vitest.shared";\n\nexport default mergeConfig(shared, defineConfig({ plugins: [] }));\n`,
      },
    ];
    for (const { label, head, names } of heads) {
      const signals = await run(BASE, head);
      expect(signals, `${label}: one TI09 signal`).toHaveLength(1);
      expect(signals[0]?.severity, label).toBe("warn");
      expect(signals[0]?.detail, label).toContain("test.include cannot be compared");
      if (names !== undefined) expect(signals[0]?.detail, `${label} names the head text`).toContain(names);
    }

    const spread = (environment: string) =>
      `${IMPORT}\n\nexport default defineConfig({\n  test: {\n    environment: "${environment}",\n    exclude: [...configDefaults.exclude, "e2e/**"],\n  },\n});\n`;
    expect(await run(spread("node"), spread("jsdom")), "the same opaque spread at base and head: no TI09").toEqual([]);

    const unknown = await run(
      BASE,
      `import { makeConfig } from "./make-config";\n\nexport default makeConfig({\n  test: {\n    include: ["src/**/*.test.ts"],\n  },\n});\n`,
    );
    expect(unknown, "an unknown default-export call: one TI09 signal").toHaveLength(1);
    expect(unknown[0]?.severity).toBe("warn");
    expect(unknown[0]?.detail, "the key is (config)").toContain("(config)");
  });
});
