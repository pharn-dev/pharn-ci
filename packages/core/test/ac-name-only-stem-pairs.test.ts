import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index, the body-token helpers and the fixture are loaded inside the test body: the AC test is
// written before the build writes fixtures/test-integrity-precision/TI01/ti06-stem-loosened and before TI01's
// same-stem rule asks for body evidence, so nothing that depends on them may run while the file loads. The test first
// checks that the fixture holds the case: test/pricing.test.ts is deleted, src/pricing.test.ts is added, every deleted
// test's body is kept by a body-token Jaccard of at least 4/5 in a distinct added test, and exactly one added test has
// its `toBe(…)` loosened to `toBeTruthy()`. The same-stem matches are judged as pairs, so TI06 reports that test at
// its head path and head line.

const REPO_ROOT = "/home/runner/work/demo/demo";
const DELETED = "test/pricing.test.ts";
const ADDED = "src/pricing.test.ts";

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
interface Block {
  kind: string;
  path: string[];
  line: number;
  body: string;
  assertionCount: number;
  assertions: { chain: string }[];
}
interface Report {
  testIntegrity: { signals: Signal[] };
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

async function testsOf(files: SourceFile[], path: string): Promise<Block[]> {
  const file = files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`the fixture has no text for ${path}`);
  const core = (await import("@pharn-ci/core")) as unknown as {
    indexTestFile(path: string, text: string): { parsed: boolean; tests?: Block[] };
  };
  const result = core.indexTestFile(file.path, file.text);
  if (!result.parsed) throw new Error(`the fixture ${file.path} does not parse: ${JSON.stringify(result)}`);
  return (result.tests ?? []).filter((b) => b.kind === "test");
}

function diffSection(diff: string, path: string): string {
  const part = diff.split(/^(?=diff --git )/m).find((p) => p.startsWith(`diff --git a/${path} b/${path}`));
  if (part === undefined) throw new Error(`the diff has no section for ${path}`);
  return part;
}

const fullName = (b: Block) => b.path.join(" › ");
const loosened = (b: Block) => b.assertions.some((a) => a.chain.includes(".toBeTruthy("));
const strict = (b: Block) => b.assertions.some((a) => a.chain.includes(".toBe("));

describe("TI01 same stem: the replacement's matches are judged as pairs", () => {
  it("AC-3: a same-stem replacement keeping every body by Jaccard 4/5 with one toBe(…) loosened to toBeTruthy() is an info TI01 and a TI06 for the loosened test at its head path and head line", async () => {
    const root = `${FIXTURES}test-integrity-precision/TI01/ti06-stem-loosened/`;
    const diff = readFileSync(`${root}change.diff`, "utf8");
    const base = sideFiles(`${root}base`);
    const head = sideFiles(`${root}head`);

    expect(diffSection(diff, DELETED), `${DELETED} is deleted`).toMatch(/^deleted file mode/m);
    expect(diffSection(diff, ADDED), `${ADDED} is added`).toMatch(/^new file mode/m);

    const tokens = (await import("../src/signals/bodyTokens.js")) as unknown as {
      bodyTokenSet(body: string): Set<string>;
      jaccardAtLeast(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean;
    };
    const was = await testsOf(base, DELETED);
    const now = await testsOf(head, ADDED);
    expect(was.length, "the deleted file held tests").toBeGreaterThan(0);
    const used = new Set<Block>();
    const heldBy = new Map<Block, Block>();
    for (const t of was) {
      expect(t.assertionCount, `"${fullName(t)}" asserts at base`).toBeGreaterThan(0);
      const held = now.find(
        (h) =>
          !used.has(h) &&
          h.assertionCount > 0 &&
          tokens.jaccardAtLeast(tokens.bodyTokenSet(t.body), tokens.bodyTokenSet(h.body)),
      );
      expect(held, `"${fullName(t)}" is kept by a Jaccard of at least 4/5`).toBeDefined();
      used.add(held as Block);
      heldBy.set(t, held as Block);
    }
    const weakened = [...heldBy].filter(([t, h]) => strict(t) && !loosened(t) && loosened(h));
    expect(weakened, "exactly one kept test loosens toBe(…) to toBeTruthy()").toHaveLength(1);
    const now06 = (weakened[0] as [Block, Block])[1];

    const { check } = await import("../src/check.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [...new Set([...head.map((f) => f.path), "src/pricing.ts"])].sort(),
      testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
      testIntegrityMode: { input: "block" },
    } as unknown as Parameters<typeof check>[0]) as unknown as Report;
    expectValidReport(report);

    const signals = report.testIntegrity.signals;
    const ti01 = signals.filter((s) => String(s.id) === "TI01" && s.path === DELETED);
    expect(ti01, `one TI01 signal for ${DELETED}`).toHaveLength(1);
    expect(ti01[0]?.severity).toBe("info");
    const ti06 = signals.filter((s) => String(s.id) === "TI06");
    expect(
      ti06.map((s) => `${s.path}:${s.line}`),
      "a TI06 for the loosened test at its head path and head line",
    ).toContain(`${ADDED}:${now06.line}`);
  });
});
