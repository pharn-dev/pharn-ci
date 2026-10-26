import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside each test body: the AC tests are written before the new TI01 and TI02
// rules exist, so nothing that depends on them may run while the file loads. The Skylos cases and the existing
// block-replaced-dissimilar fixture are not edited by this increment; what must hold is that the new rules leave them
// caught. So that this proves something about the new rules (and not only about today's matching), a control first
// shows the rules are live in the tree under test: the precision fixture of a one-line test renamed in place, which
// today's matching reports, gives no TI02.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";

const NINE = [
  "deleted-test",
  "added-skip",
  "emptied-assertion",
  "deselect-setting",
  "hard-coded-answer",
  "always-true-matcher",
  "replaced-test",
  "loosened-assertion",
  "edited-expected-value",
] as const;
const CAUGHT: ReadonlyMap<string, string> = new Map([
  ["deleted-test", "TI01"],
  ["added-skip", "TI03"],
  ["emptied-assertion", "TI05"],
  ["deselect-setting", "TI09"],
  ["replaced-test", "TI02"],
  ["loosened-assertion", "TI06"],
  ["edited-expected-value", "TI07"],
]);

interface SourceFile {
  path: string;
  text: string;
}
interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

const sourcesAt = (dir: string) => {
  const base = sideFiles(`${dir}/base`);
  const head = sideFiles(`${dir}/head`);
  return base.length + head.length === 0
    ? {}
    : { testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } } };
};

async function run(diff: string, repoFiles: string[], extra: Record<string, unknown>): Promise<Signal[]> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles,
    testIntegrityMode: { input: "block" },
    ...extra,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report.testIntegrity.signals as unknown as Signal[];
}

const skylos = (name: string) =>
  run(
    fixture(`skylos-nine/${name}/change.diff`),
    fixture(`skylos-nine/${name}/files.txt`).trim().split("\n"),
    sourcesAt(`${FIXTURES}skylos-nine-sources/${name}`),
  );

async function expectRulesLive(): Promise<void> {
  const dir = `${FIXTURES}test-integrity-precision/TI02/pass-rename-literal-changed`;
  const sources = sourcesAt(dir);
  expect("testSources" in sources, "the control fixture has sources").toBe(true);
  const signals = await run(
    readFileSync(`${dir}/change.diff`, "utf8"),
    ["src/format.test.ts", "src/format.ts"],
    sources,
  );
  expect(
    signals.filter((s) => String(s.id) === "TI02"),
    "control: the new rules are live (a renamed one-line test gives no TI02)",
  ).toEqual([]);
}

const ofId = (signals: Signal[], id: string) => signals.filter((s) => String(s.id) === id);

describe("TI01 and TI02 precision leave the Skylos cases caught", () => {
  it("AC-7: with the new rules live, Skylos replaced-test is still one block TI02, deleted-test still a block TI01, and block-replaced-dissimilar still one block TI02", async () => {
    await expectRulesLive();

    const replaced = ofId(await skylos("replaced-test"), "TI02");
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.severity).toBe("block");
    expect(replaced[0]?.path).toBe(PATH);

    const deleted = ofId(await skylos("deleted-test"), "TI01");
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.severity).toBe("block");
    expect(deleted[0]?.detail).toBe("Test file deleted; its removed lines defined tests.");

    const dir = `${FIXTURES}test-integrity/TI02/block-replaced-dissimilar`;
    const dissimilar = ofId(
      await run(readFileSync(`${dir}/change.diff`, "utf8"), [PATH, "src/cart.ts"], sourcesAt(dir)),
      "TI02",
    );
    expect(dissimilar).toHaveLength(1);
    expect(dissimilar[0]?.severity).toBe("block");
    expect(dissimilar[0]?.path).toBe(PATH);
  }, 60_000);

  it("AC-7: with the new rules live, the nine Skylos cases run with their sources still catch 7 of 9, each by its signal", async () => {
    await expectRulesLive();

    let caught = 0;
    for (const name of NINE) {
      const signals = await skylos(name);
      const id = CAUGHT.get(name);
      if (id === undefined) continue;
      expect(
        signals.some((s) => String(s.id) === id && s.severity !== "info"),
        `${name} is caught by ${id}`,
      ).toBe(true);
      caught++;
    }
    expect(caught).toBe(7);
  }, 60_000);
});
