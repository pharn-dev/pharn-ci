import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI15 matches within a package root, and the
// fixtures it reads are written by the build, so nothing the build adds may run while the file loads. The fixtures
// run with the test-files-deleted repo files, which hold no manifest; the inline diffs run with repo files that do.

const REPO_ROOT = "/home/runner/work/demo/demo";
/** The signal id and the literal, built from parts so this file adds neither as written. */
const ID = ["TI", "15"].join("");
const LITERAL = ["prem", "ium-tier"].join("");

/** A modified file that adds `lines` from line `at`. */
function addLines(path: string, at: number, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, `@@ -${at - 1},0 +${at},${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

function addFile(path: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "new file mode 100644", "index 0000000..2222222 100644"];
  const body = ["--- /dev/null", `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)];
  return `${[...head, ...body].join("\n")}\n`;
}

const testLine = (path: string) => addLines(path, 8, [`  expect(f("${LITERAL}")).toBe(1);`]);
const sourceLine = (path: string) => addLines(path, 12, [`  if (s === "${LITERAL}") return 1;`]);

async function runWith(diff: string, repoFiles: string[]) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles,
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return signalsOf(report, ID);
}

describe("TI15: a test literal matches a source condition only within one package root", () => {
  it("AC-7: a test and a source under different package.json or pyproject.toml roots, or separated by a manifest the diff adds, give no TI15; one package gives warn TI15 naming the first same-root test path in code-unit order", async () => {
    // Two package.json manifests, the test under one and the source under the other.
    const crossTest = "packages/a/src/x.test.ts";
    const crossSource = "packages/b/src/x.ts";
    expect(
      await runWith(testLine(crossTest) + sourceLine(crossSource), [
        "package.json",
        "packages/a/package.json",
        "packages/b/package.json",
        crossTest,
        crossSource,
      ]),
      "different package.json roots",
    ).toEqual([]);

    // A nested pyproject.toml with the source under it, the test beside packages/a/package.json.
    const nestedTest = "packages/a/test/x.test.ts";
    const nestedSource = "packages/a/sub/src/x.ts";
    expect(
      await runWith(testLine(nestedTest) + sourceLine(nestedSource), [
        "packages/a/package.json",
        "packages/a/sub/pyproject.toml",
        nestedTest,
        nestedSource,
      ]),
      "a nested pyproject.toml root",
    ).toEqual([]);

    // Only the root package.json in repoFiles; the diff adds packages/b/package.json with the source under it.
    const addedTest = "packages/a/src/x.test.ts";
    const addedSource = "packages/b/src/x.ts";
    const rootOnly = ["package.json", addedTest, addedSource];
    const withoutManifest = testLine(addedTest) + sourceLine(addedSource);
    const control = await runWith(withoutManifest, rootOnly);
    expect(control, "control: both under the root package.json match").toHaveLength(1);
    expect(control[0]?.severity).toBe("warn");
    const manifest = addFile("packages/b/package.json", ["{", '  "name": "b",', '  "private": true', "}"]);
    expect(await runWith(withoutManifest + manifest, rootOnly), "the diff-added manifest separates them").toEqual([]);

    // Both files under one manifest, two same-root test files: the detail names the first in code-unit order.
    const one = await runWith(testLine("src/z.test.ts") + testLine("src/b.test.ts") + sourceLine("src/x.ts"), [
      "package.json",
      "src/b.test.ts",
      "src/x.ts",
      "src/z.test.ts",
    ]);
    expect(one, "one manifest").toHaveLength(1);
    expect(one[0]).toMatchObject({ severity: "warn", path: "src/x.ts", line: 12 });
    expect(one[0]?.detail).toContain("src/b.test.ts");
    expect(one[0]?.detail).not.toContain("src/z.test.ts");

    // The fixtures, with repo files that hold no manifest: the packages/ fallback decides the root.
    const other = fixture("test-integrity/TI15/pass-other-package.diff");
    expect(other, "the test sits under packages/a").toMatch(/^\+\+\+ b\/packages\/a\/\S*(?:test|spec)\S*$/m);
    expect(other, "the source sits under packages/b").toMatch(/^\+\+\+ b\/packages\/b\//m);
    expect(signalsOf(await runDiff(other, "block"), ID), "pass-other-package.diff").toEqual([]);

    const same = signalsOf(await runDiff(fixture("test-integrity/TI15/warn-same-package.diff"), "block"), ID);
    expect(same.length, "warn-same-package.diff").toBeGreaterThan(0);
    for (const signal of same) expect(signal.severity, "warn-same-package.diff").toBe("warn");
  });
});
