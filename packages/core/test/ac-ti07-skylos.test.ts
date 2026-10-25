import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the fixtures and the docs are read inside each test body: the AC tests are written before TI07, the
// edited-expected-value sources and the 5-of-9 docs exist, so nothing that depends on them may run while the file
// loads. A case counts as caught when its report holds a test-integrity signal, as at the base commit (4 of 9).

const REPO_ROOT = "/home/runner/work/demo/demo";
const CASES = [
  "added-skip",
  "always-true-matcher",
  "deleted-test",
  "deselect-setting",
  "edited-expected-value",
  "emptied-assertion",
  "hard-coded-answer",
  "loosened-assertion",
  "replaced-test",
];
/** The caught cases and the signal that catches each. */
const CAUGHT: Record<string, string> = {
  "deleted-test": "TI01",
  "added-skip": "TI03",
  "emptied-assertion": "TI05",
  "replaced-test": "TI02",
  "edited-expected-value": "TI07",
};

interface SourceFile {
  path: string;
  text: string;
}
interface Report {
  testIntegrity: { signals: { id: string }[] };
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function sideFiles(dir: string): SourceFile[] {
  const names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  return names
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

async function runCase(name: string): Promise<Report> {
  const sourcesDir = `${FIXTURES}skylos-nine-sources/${name}`;
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: fixture(`skylos-nine/${name}/change.diff`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture(`skylos-nine/${name}/files.txt`).trim().split("\n"),
    ...(existsSync(sourcesDir)
      ? {
          testSources: {
            base: { files: sideFiles(`${sourcesDir}/base`), dropped: [] },
            head: { files: sideFiles(`${sourcesDir}/head`), dropped: [] },
          },
        }
      : {}),
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

/** The lines of a document section: from its heading line to the next heading of the same or a higher level. */
function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const at = lines.indexOf(heading);
  if (at === -1) throw new Error(`no heading ${heading}`);
  const level = (/^#+/.exec(heading)?.[0] ?? "").length;
  const end = lines.findIndex(
    (line, i) => i > at && /^#+ /.test(line) && (/^#+/.exec(line)?.[0] ?? "").length <= level,
  );
  return lines.slice(at, end === -1 ? lines.length : end).join("\n");
}

describe("Skylos nine: edited-expected-value is caught by TI07, 5 of 9", () => {
  it("AC-14: edited-expected-value's diff also edits src/cart.ts without a new conditional, with no context lines and no .py path, and has test sources", () => {
    const diff = fixture("skylos-nine/edited-expected-value/change.diff");
    const chunks = diff.split(/^(?=diff --git )/m).filter((c) => c.startsWith("diff --git "));
    const paths = chunks.map((c) => /^diff --git a\/(\S+) b\/(\S+)$/m.exec(c)?.[2]);
    expect(paths).toContain("src/cart.test.ts");
    expect(paths).toContain("src/cart.ts");
    expect(diff).not.toMatch(/\.py\b/);
    const source = chunks.find((c) => /^diff --git a\/src\/cart\.ts b\/src\/cart\.ts$/m.test(c)) as string;
    expect(source).not.toMatch(/^new file mode|^deleted file mode/m);
    const hunkLines = (chunk: string) => {
      const lines = chunk.split("\n");
      const first = lines.findIndex((l) => l.startsWith("@@"));
      return lines.slice(first).filter((l) => l !== "");
    };
    for (const chunk of chunks) {
      for (const line of hunkLines(chunk)) expect(line, "no context lines").toMatch(/^(@@|\+|-)/);
    }
    const addedSource = hunkLines(source).filter((l) => l.startsWith("+"));
    expect(addedSource.length, "the source edit adds a line").toBeGreaterThan(0);
    for (const line of addedSource) expect(line, "no new conditional").not.toMatch(/\bif\b|\?|\bswitch\b|&&|\|\|/);

    const root = `${FIXTURES}skylos-nine-sources/edited-expected-value`;
    const base = sideFiles(`${root}/base`);
    const head = sideFiles(`${root}/head`);
    const textOf = (files: SourceFile[]) => files.find((f) => f.path === "src/cart.test.ts")?.text ?? "";
    expect(textOf(base).split("\n")[7]).toContain("expect(total([2, 3])).toBe(5);");
    expect(textOf(head).split("\n")[7]).toContain("expect(total([2, 3])).toBe(6);");
  });

  it("AC-14: the nine run with their sources: edited-expected-value is caught by TI07 and no TI15, and the caught count is 5 of 9", async () => {
    expect(readdirSync(`${FIXTURES}skylos-nine`).sort()).toEqual(CASES);
    const caught: Record<string, string[]> = {};
    for (const name of CASES) {
      const report = await runCase(name);
      const ids = [...new Set(report.testIntegrity.signals.map((s) => String(s.id)))].sort();
      if (ids.length > 0) caught[name] = ids;
    }
    expect(Object.keys(caught).sort()).toEqual(Object.keys(CAUGHT).sort());
    for (const [name, id] of Object.entries(CAUGHT)) expect(caught[name], name).toContain(id);
    expect(caught["edited-expected-value"]).toContain("TI07");
    expect(caught["edited-expected-value"]).not.toContain("TI15");
    expect(Object.keys(caught)).toHaveLength(5);
  });

  it("AC-14: README and docs/LIMITS.md say 5 of 9, with edited-expected-value caught by TI07 and a missed list of 4", () => {
    const readme = section(readFileSync(`${FIXTURES}../README.md`, "utf8"), "## Test integrity");
    expect(readme).toContain("**5 of 9**");
    expect(readme).not.toContain("4 of 9");
    expect(readme).toMatch(/`edited-expected-value` by TI07/);
    expect(readme).toMatch(/other four/i);

    const limits = section(
      readFileSync(`${FIXTURES}../docs/LIMITS.md`, "utf8"),
      "## What test integrity does not catch",
    );
    expect(limits).toContain("**5 of 9**");
    expect(limits).not.toContain("4 of 9");
    const caught = [...limits.matchAll(/^- `([a-z-]+)` — caught by (TI\d\d)\b/gm)].map((m) => `${m[1]} ${m[2]}`);
    expect(caught.sort()).toEqual(
      Object.entries(CAUGHT)
        .map(([name, id]) => `${name} ${id}`)
        .sort(),
    );
    const missed = [...limits.matchAll(/^- `([a-z-]+)` — missed\b/gm)].map((m) => m[1]);
    expect(missed).toHaveLength(4);
    expect(missed).not.toContain("edited-expected-value");
  });
});
