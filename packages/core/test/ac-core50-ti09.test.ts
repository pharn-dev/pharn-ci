import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TestIntegritySignal as Signal } from "../src/report.js";
import type { TestSourceDrop, TestSourceDropReason } from "../src/testSources.js";
import { FIXTURES } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-50 (binary-diff-not-blind). check() is loaded inside the test body: the AC test is written before TI09 stops
// skipping a test-runner config that git shows as binary, so nothing the build changes may run while the file loads. A
// case directory holds change.diff (the binary entry), optionally text.diff (the same change as a text diff) and base/
// and head/ with `<path>.txt`, read inside the test body; the diff and texts are checked first.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "vitest.config.ts";
const BINARY_LINE = `Binary files a/${PATH} and b/${PATH} differ`;

interface Side {
  files: { path: string; text: string }[];
  dropped: TestSourceDrop[];
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function readSide(dir: string): Side {
  const side: Side = { files: [], dropped: [] };
  if (!existsSync(dir)) return side;
  const names = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => statSync(join(dir, name)).isFile());
  for (const name of names) {
    const text = readFileSync(join(dir, name), "utf8");
    if (name.endsWith(".txt")) side.files.push({ path: name.slice(0, -".txt".length), text });
    else if (name.endsWith(".dropped"))
      side.dropped.push({ path: name.slice(0, -".dropped".length), reason: text.trim() as TestSourceDropReason });
  }
  side.files.sort(byPath);
  side.dropped.sort(byPath);
  return side;
}

function loadCase(name: string) {
  const dir = `${FIXTURES}test-integrity/TI09/${name}`;
  return {
    diff: readFileSync(join(dir, "change.diff"), "utf8"),
    textDiff: existsSync(join(dir, "text.diff")) ? readFileSync(join(dir, "text.diff"), "utf8") : undefined,
    sources: { base: readSide(join(dir, "base")), head: readSide(join(dir, "head")) },
  };
}

async function ti09(diff: string, sources: { base: Side; head: Side }): Promise<Signal[]> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["src/cart.ts", ...sources.head.files.map((file) => file.path)].sort(),
    testIntegrityMode: { input: "block" },
    testSources: sources,
  });
  expectValidReport(report);
  return report.testIntegrity.signals.filter((s) => s.id === "TI09");
}

const textOf = (side: Side, path: string) => side.files.find((f) => f.path === path)?.text;

describe("CORE-50: TI09 judges a test-runner config that git shows as binary from its base and head text", () => {
  it("AC-13: a binary vitest.config.ts that adds passWithNoTests: true gives the TI09 signals of the text diff; the same keys and values give no TI09", async () => {
    const added = loadCase("block-binary-pass-with-no-tests");
    expect(added.diff.split("\n")).toContain(BINARY_LINE);
    expect(added.textDiff, "the case carries the same change as a text diff").toBeDefined();
    const textDiff = added.textDiff as string;
    expect(textDiff.includes("Binary files"), "text.diff is a text diff").toBe(false);
    expect(
      textDiff.split("\n").some((l) => l.startsWith("@@")),
      "text.diff has a hunk",
    ).toBe(true);
    const base = textOf(added.sources.base, PATH);
    const head = textOf(added.sources.head, PATH);
    expect(base, "the base text").toBeDefined();
    expect(base, "the base sets no passWithNoTests").not.toContain("passWithNoTests");
    expect(head, "the head sets passWithNoTests: true").toMatch(/passWithNoTests:\s*true/);

    const fromText = await ti09(textDiff, added.sources);
    expect(fromText.length, "the text diff gives a TI09").toBeGreaterThan(0);
    const fromBinary = await ti09(added.diff, added.sources);
    expect(fromBinary, "the binary entry gives the text diff's TI09 signals").toEqual(fromText);

    const same = loadCase("pass-binary-same-settings");
    expect(same.diff.split("\n")).toContain(BINARY_LINE);
    expect(textOf(same.sources.base, PATH), "the base text").toBeDefined();
    expect(textOf(same.sources.head, PATH), "the head text").toBeDefined();
    expect(await ti09(same.diff, same.sources), "no TI09").toEqual([]);
  });
});
