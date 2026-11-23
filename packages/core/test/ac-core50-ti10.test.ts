import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-50 (binary-diff-not-blind). check() is loaded inside each test body: the AC tests are written before TI10 reads a
// package.json that git shows as binary, so nothing the build changes may run while the file loads. A case directory
// holds change.diff (the binary entry), optionally text.diff (the same change as a text diff) and base/ and head/ with
// `<path>.txt` and `<path>.dropped`, read inside the test bodies. Each test first checks the case's diff and texts.

const REPO_ROOT = "/home/runner/work/demo/demo";
const BINARY = "git shows this file as binary, so its changes could not be read.";
const BINARY_LINE = "Binary files a/package.json and b/package.json differ";

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Message {
  code: string;
  level: string;
}
interface Report {
  messages: Message[];
  testIntegrity: { signals: Signal[] };
}
interface Side {
  files: { path: string; text: string }[];
  dropped: { path: string; reason: string }[];
}
interface Sources {
  base: Side;
  head: Side;
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function readSide(dir: string): Side | null {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => statSync(join(dir, name)).isFile());
  const side: Side = { files: [], dropped: [] };
  for (const name of names) {
    const text = readFileSync(join(dir, name), "utf8");
    if (name.endsWith(".txt")) side.files.push({ path: name.slice(0, -".txt".length), text });
    else if (name.endsWith(".dropped"))
      side.dropped.push({ path: name.slice(0, -".dropped".length), reason: text.trim() });
  }
  side.files.sort(byPath);
  side.dropped.sort(byPath);
  return side;
}

function loadCase(name: string) {
  const dir = `${FIXTURES}test-integrity/TI10/${name}`;
  const diff = readFileSync(join(dir, "change.diff"), "utf8");
  const textDiff = existsSync(join(dir, "text.diff")) ? readFileSync(join(dir, "text.diff"), "utf8") : undefined;
  const base = readSide(join(dir, "base"));
  const head = readSide(join(dir, "head"));
  const empty: Side = { files: [], dropped: [] };
  const sources: Sources | undefined =
    base === null && head === null ? undefined : { base: base ?? empty, head: head ?? empty };
  return { diff, textDiff, sources };
}

async function run(diff: string, mode: "block" | "warn", sources: Sources | undefined): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["package.json", "src/a.test.ts", "src/a.ts"],
    testIntegrityMode: { input: mode },
    ...(sources === undefined ? {} : { testSources: sources }),
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

const ti10 = (report: Report) => report.testIntegrity.signals.filter((s) => s.id === "TI10");
const textOf = (side: Side | undefined, path: string) => side?.files.find((f) => f.path === path)?.text;

describe("CORE-50: TI10 and a package.json that git shows as binary", () => {
  it("AC-9: a binary package.json with no test sources, or with the head dropped as too-large, gives exactly one TI10 with the fixed binary detail: block and an error in block, warn in warn", async () => {
    const noSources = loadCase("block-binary-no-sources");
    expect(noSources.diff.split("\n")).toContain(BINARY_LINE);
    expect(noSources.sources, "block-binary-no-sources carries no test sources").toBeUndefined();

    const headDropped = loadCase("block-binary-head-dropped");
    expect(headDropped.diff.split("\n")).toContain(BINARY_LINE);
    expect(headDropped.sources?.head.dropped).toEqual([{ path: "package.json", reason: "too-large" }]);
    const baseText = textOf(headDropped.sources?.base, "package.json");
    expect(baseText, "the base text of package.json").toBeDefined();
    expect(JSON.parse(baseText as string).scripts?.test, "the base test script").toBe("vitest run");

    for (const [name, { diff, sources }] of [
      ["no sources", noSources],
      ["head dropped as too-large", headDropped],
    ] as const) {
      const block = await run(diff, "block", sources);
      expect(ti10(block), `${name}: one block TI10`).toEqual([
        expect.objectContaining({ id: "TI10", severity: "block", path: "package.json", line: null, detail: BINARY }),
      ]);
      expect(
        block.messages.filter((m) => m.code === "TEST_INTEGRITY_TI10").map((m) => m.level),
        `${name}: one TEST_INTEGRITY_TI10 error`,
      ).toEqual(["error"]);

      const warn = await run(diff, "warn", sources);
      expect(ti10(warn), `${name}: one warn TI10`).toEqual([
        expect.objectContaining({ id: "TI10", severity: "warn", path: "package.json", line: null, detail: BINARY }),
      ]);
    }
  });

  it("AC-10: with base and head texts that read as JSON, a binary package.json gives the TI10 signals of the text diff (the || true finding at the test script's head line); equal scripts give no TI10", async () => {
    const orTrue = loadCase("block-binary-or-true-sources");
    expect(orTrue.diff.split("\n")).toContain(BINARY_LINE);
    expect(orTrue.textDiff, "the case carries the same change as a text diff").toBeDefined();
    const textDiff = orTrue.textDiff as string;
    expect(textDiff.includes("Binary files"), "text.diff is a text diff").toBe(false);
    expect(
      textDiff.split("\n").some((l) => l.startsWith("@@")),
      "text.diff has a hunk",
    ).toBe(true);
    const base = textOf(orTrue.sources?.base, "package.json");
    const head = textOf(orTrue.sources?.head, "package.json");
    expect(JSON.parse(base as string).scripts?.test).toBe("vitest run");
    expect(JSON.parse(head as string).scripts?.test).toBe("vitest run || true");
    const testLine = (head as string).split("\n").findIndex((l) => /^\s*"test"\s*:/.test(l)) + 1;
    expect(testLine, "the head text holds the test key").toBeGreaterThan(0);

    const fromText = ti10(await run(textDiff, "block", orTrue.sources));
    expect(fromText.length, "the text diff gives a TI10").toBeGreaterThan(0);
    expect(
      fromText.some((s) => s.severity === "block" && s.path === "package.json" && s.line === testLine),
      "the || true finding at the head line of the test script",
    ).toBe(true);

    const fromBinary = ti10(await run(orTrue.diff, "block", orTrue.sources));
    expect(fromBinary, "the binary entry gives the text diff's TI10 signals").toEqual(fromText);
    expect(
      fromBinary.filter((s) => s.detail === BINARY),
      "no binary detail",
    ).toEqual([]);

    const equal = loadCase("pass-binary-scripts-equal");
    expect(equal.diff.split("\n")).toContain(BINARY_LINE);
    const equalBase = JSON.parse(textOf(equal.sources?.base, "package.json") as string);
    const equalHead = JSON.parse(textOf(equal.sources?.head, "package.json") as string);
    expect(equalHead.scripts, "the scripts objects are equal").toEqual(equalBase.scripts);
    expect(ti10(await run(equal.diff, "block", equal.sources)), "no TI10").toEqual([]);
  });
});
