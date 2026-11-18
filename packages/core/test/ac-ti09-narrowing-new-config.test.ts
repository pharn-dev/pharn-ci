import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-70: TI09 judges a config new at head on its narrowing keys, at `warn` in every mode. check() is loaded inside
// each test body, so nothing the build adds runs while the file loads. Each case is a directory of
// fixtures/test-integrity/TI09/ (change.diff, base/<path>.txt, head/<path>.txt), read as ti09y-fixtures.test.ts reads it.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TI09 = `${FIXTURES}test-integrity/TI09`;

type Mode = "block" | "warn";

interface SourceFile {
  path: string;
  text: string;
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  try {
    statSync(dir);
  } catch {
    return [];
  }
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

/** The TI09 signals of one case directory run through check() in `mode`; the report is schema-validated. */
async function ti09Of(name: string, mode: Mode) {
  const { check } = await import("../src/check.js");
  const dir = join(TI09, name);
  const diff = readFileSync(join(dir, "change.diff"), "utf8");
  const head = sideFiles(join(dir, "head"));
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", ...head.map((file) => file.path)].sort(),
    testIntegrityMode: { input: mode },
    testSources: {
      base: { files: sideFiles(join(dir, "base")), dropped: [] },
      head: { files: head, dropped: [] },
    },
  });
  expectValidReport(report);
  return report.testIntegrity.signals.filter((signal) => signal.id === "TI09");
}

describe("CORE-70: TI09 on a config new at head", () => {
  it("AC-1: a new vitest test.exclude and a new pytest testpaths each give a TI09 at warn in modes block and warn", async () => {
    for (const mode of ["block", "warn"] as const) {
      const vitest = await ti09Of("warn-added-vitest-exclude", mode);
      expect(
        vitest.some((signal) => signal.detail.includes("test.exclude")),
        `${mode}: a TI09 naming test.exclude`,
      ).toBe(true);
      expect(
        vitest.map((signal) => signal.severity),
        `${mode}: vitest severities`,
      ).toEqual(vitest.map(() => "warn"));

      const pytest = await ti09Of("warn-added-pytest-testpaths", mode);
      expect(
        pytest.some((signal) => signal.detail.includes("testpaths")),
        `${mode}: a TI09 naming testpaths`,
      ).toBe(true);
      expect(
        pytest.map((signal) => signal.severity),
        `${mode}: pytest severities`,
      ).toEqual(pytest.map(() => "warn"));
    }
  });

  it("AC-2: a new jest passWithNoTests stays block and a new vitest test.retry stays warn in mode block", async () => {
    const jest = await ti09Of("block-added-jest-config", "block");
    expect(
      jest.some((signal) => signal.detail.includes("passWithNoTests") && signal.severity === "block"),
      "a block TI09 naming passWithNoTests",
    ).toBe(true);

    const retry = await ti09Of("warn-added-vitest-retry", "block");
    expect(
      retry.some((signal) => signal.detail.includes("test.retry") && signal.severity === "warn"),
      "a warn TI09 naming test.retry",
    ).toBe(true);
    expect(
      retry.some((signal) => signal.detail.includes("test.retry") && signal.severity === "block"),
      "no block TI09 naming test.retry",
    ).toBe(false);
  });

  it("AC-3: a new vitest config with include, exclude and a threshold gives one warn for test.include and one for test.exclude only", async () => {
    const head = readFileSync(join(TI09, "warn-added-vitest-config", "head", "vitest.config.ts.txt"), "utf8");
    expect(head).toContain('include: ["src/**/*.test.ts"]');
    expect(head).toContain('exclude: ["e2e/**"]');
    expect(head).toContain("lines: 80");

    const signals = await ti09Of("warn-added-vitest-config", "block");
    const include = signals.filter((signal) => signal.detail.includes("test.include"));
    const exclude = signals.filter((signal) => signal.detail.includes("test.exclude"));
    expect(include, "one TI09 naming test.include").toHaveLength(1);
    expect(exclude, "one TI09 naming test.exclude").toHaveLength(1);
    expect(include[0]?.severity).toBe("warn");
    expect(exclude[0]?.severity).toBe("warn");
    expect(
      signals.filter((signal) => signal.severity === "block"),
      "no block TI09",
    ).toEqual([]);
    expect(
      signals.filter((signal) => signal.detail.includes("test.coverage.thresholds")),
      "no TI09 naming test.coverage.thresholds",
    ).toEqual([]);
  });

  it("AC-4: a new vitest config with only test.environment, or only a node_modules exclude, gives no TI09", async () => {
    expect(await ti09Of("pass-added-vitest-environment", "block"), "environment only").toEqual([]);
    expect(await ti09Of("pass-added-vitest-exclude-node-modules", "block"), "node_modules exclude").toEqual([]);
  });

  it("a new vitest exclude that spreads configDefaults.exclude gives nothing alone or with build entries, and a warn naming test.exclude with a project entry", async () => {
    expect(
      await ti09Of("pass-added-vitest-config-defaults", "block"),
      "the defaults plus dist and node_modules",
    ).toEqual([]);

    // The spread alone: the same config without the two build entries.
    const { check } = await import("../src/check.js");
    const text = readFileSync(join(TI09, "pass-added-vitest-config-defaults", "head", "vitest.config.ts.txt"), "utf8")
      .split(', "dist/**", "**/node_modules/**"')
      .join("");
    expect(text).toContain("exclude: [...configDefaults.exclude],");
    const lines = text.split("\n").filter((line, i, all) => i < all.length - 1 || line !== "");
    const diff = [
      "diff --git a/vitest.config.ts b/vitest.config.ts",
      "new file mode 100644",
      "index 0000000..2222222",
      "--- /dev/null",
      "+++ b/vitest.config.ts",
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
      "",
    ].join("\n");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: ["src/cart.ts", "vitest.config.ts"],
      testIntegrityMode: { input: "block" },
      testSources: {
        base: { files: [], dropped: [] },
        head: { files: [{ path: "vitest.config.ts", text }], dropped: [] },
      },
    });
    expectValidReport(report);
    expect(
      report.testIntegrity.signals.filter((signal) => signal.id === "TI09"),
      "the spread alone",
    ).toEqual([]);

    const spread = await ti09Of("warn-added-vitest-config-defaults-spread", "block");
    expect(spread, "one TI09").toHaveLength(1);
    expect(spread[0]?.severity).toBe("warn");
    expect(spread[0]?.detail).toContain("test.exclude");
    expect(spread[0]?.detail).not.toContain("cannot be compared");
  });
});
