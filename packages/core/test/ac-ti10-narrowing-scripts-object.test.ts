import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-70: when both the base and the head text of a modified package.json are in the test sources, TI10 compares the
// `scripts` objects, so the file's layout does not matter; otherwise it reads the diff lines as before. check() is
// loaded inside each test body. Each case is a directory of fixtures/test-integrity/TI10/ (change.diff,
// base/package.json.txt, head/package.json.txt).

const REPO_ROOT = "/home/runner/work/demo/demo";
const REPO_FILES = ["package.json", "src/a.ts", "src/a.test.ts"];
const PATH = "package.json";

interface SideSources {
  files: Array<{ path: string; text: string }>;
  dropped: Array<{ path: string; reason: string }>;
}
interface Sources {
  base: SideSources;
  head: SideSources;
}

const caseFile = (name: string, file: string) => fixture(`test-integrity/TI10/${name}/${file}`);

/** Both texts of a case's package.json as test sources. */
function bothSides(name: string): { sources: Sources; base: string; head: string } {
  const base = caseFile(name, "base/package.json.txt");
  const head = caseFile(name, "head/package.json.txt");
  return {
    base,
    head,
    sources: {
      base: { files: [{ path: PATH, text: base }], dropped: [] },
      head: { files: [{ path: PATH, text: head }], dropped: [] },
    },
  };
}

/** The head line of the first added line of a diff that holds a `"test"` key, read from the `@@ … +N` header. */
function addedTestLine(diff: string): { line: number; text: string } {
  let newLine = 0;
  for (const line of diff.split("\n")) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      newLine = Number(header[1]);
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      if (/"test"\s*:/.test(line)) return { line: newLine, text: line.slice(1) };
      newLine += 1;
    } else if (line.startsWith(" ")) {
      newLine += 1;
    }
  }
  throw new Error('the diff adds no "test" line');
}

async function ti10Of(diff: string, sources: Sources | undefined) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: REPO_FILES,
    testIntegrityMode: { input: "block" },
    ...(sources === undefined ? {} : { testSources: sources }),
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI10");
}

const withoutTrailingNewline = (text: string) => text.replace(/\n$/, "");

describe("CORE-70: TI10 compares the scripts objects when both texts are in the sources", () => {
  it("AC-12: a one-line package.json whose test script gains || true gives one block TI10 at line 1", async () => {
    const name = "block-one-line-or-true";
    const { sources, base, head } = bothSides(name);
    expect(withoutTrailingNewline(base)).toBe('{"name":"a","scripts":{"test":"vitest run"}}');
    expect(withoutTrailingNewline(head)).toBe('{"name":"a","scripts":{"test":"vitest run || true"}}');

    const signals = await ti10Of(caseFile(name, "change.diff"), sources);
    expect(signals, "one TI10").toHaveLength(1);
    expect(signals[0]?.path).toBe(PATH);
    expect(signals[0]?.line).toBe(1);
    expect(signals[0]?.severity).toBe("block");
  });

  it("AC-13: a reflowed scripts object and a config.test key give no TI10, a removed pretest gives one block TI10", async () => {
    const reflowed = bothSides("pass-scripts-reflowed");
    expect(JSON.parse(reflowed.head), "reflowed: the same object").toEqual(JSON.parse(reflowed.base));
    expect(reflowed.head, "reflowed: the text differs").not.toBe(reflowed.base);
    expect(await ti10Of(caseFile("pass-scripts-reflowed", "change.diff"), reflowed.sources), "reflowed").toEqual([]);

    const config = bothSides("pass-config-test-key");
    const configBase = JSON.parse(config.base);
    const configHead = JSON.parse(config.head);
    expect(configBase.scripts.test).toBe("vitest run");
    expect(configHead.scripts.test).toBe("vitest run");
    expect(String(configHead.config.test)).toContain("|| true");
    expect(await ti10Of(caseFile("pass-config-test-key", "change.diff"), config.sources), "config.test").toEqual([]);

    const pretest = bothSides("block-pretest-removed-object");
    expect(JSON.parse(pretest.base).scripts.pretest).toBe("pnpm lint");
    expect(Object.hasOwn(JSON.parse(pretest.head).scripts, "pretest")).toBe(false);
    const signals = await ti10Of(caseFile("block-pretest-removed-object", "change.diff"), pretest.sources);
    expect(signals, "pretest removed: one TI10").toHaveLength(1);
    expect(signals[0]?.path).toBe(PATH);
    expect(signals[0]?.severity).toBe("block");
  });

  it("AC-14: with no sources, or a head dropped as too-large, the diff lines still give one block TI10 at the added line", async () => {
    const name = "block-or-true-head-dropped";
    const diff = caseFile(name, "change.diff");
    const added = addedTestLine(diff);
    expect(added.text).toContain('"test": "vitest run || true"');
    const base = caseFile(name, "base/package.json.txt");
    const dropped: Sources = {
      base: { files: [{ path: PATH, text: base }], dropped: [] },
      head: { files: [], dropped: [{ path: PATH, reason: "too-large" }] },
    };
    for (const [label, sources] of [
      ["no sources", undefined],
      ["head dropped", dropped],
    ] as const) {
      const signals = await ti10Of(diff, sources);
      expect(signals, `${label}: one TI10`).toHaveLength(1);
      expect(signals[0]?.path, label).toBe(PATH);
      expect(signals[0]?.line, label).toBe(added.line);
      expect(signals[0]?.severity, label).toBe("block");
    }
  });
});
