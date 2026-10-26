import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside each test body: the AC tests are written before the snapshot exclusion
// and fixtures/test-integrity-precision/ exist, so nothing that depends on them may run while the file loads. The
// fixtures are written by the build, so each test first checks that its diff holds the case. A snapshot is not a test
// file TI01 counts, but the v1 TEST_FILES_DELETED message still lists it.

const REPO_ROOT = "/home/runner/work/demo/demo";
const RENAMED_FROM = "test/__snapshots__/a.test.ts.snap";
const RENAMED_TO = "src/__snapshots__/a.test.ts.snap";
const DELETED = "test/__snapshots__/b.test.ts.snap";

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
interface Report {
  testIntegrity: { signals: Signal[] };
  messages: { code: string; level: string; text: string }[];
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

async function runCase(name: string): Promise<{ diff: string; report: Report }> {
  const root = `${FIXTURES}test-integrity-precision/TI01/${name}/`;
  const diff = readFileSync(`${root}change.diff`, "utf8");
  const base = sideFiles(`${root}base`);
  const head = sideFiles(`${root}head`);
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...head.map((f) => f.path), "src/b.ts"])].sort(),
    testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]) as unknown as Report;
  expectValidReport(report);
  return { diff, report };
}

function expectNoSnapTi01(report: Report): void {
  const ti01 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI01");
  expect(
    ti01.filter((s) => s.path.endsWith(".snap")),
    "no TI01 signal for a .snap path",
  ).toEqual([]);
}

function expectListed(report: Report, path: string): void {
  const messages = report.messages.filter((m) => String(m.code) === "TEST_FILES_DELETED");
  expect(messages, "the TEST_FILES_DELETED message is still there").toHaveLength(1);
  expect(messages[0]?.level).toBe("info");
  expect(messages[0]?.text).toContain(`\`${path}\``);
}

describe("TI01 precision: snapshot files are not TI01 candidates", () => {
  it("AC-11: a snapshot renamed from test/__snapshots__ to src/__snapshots__ gives no TI01 for it and is still listed by its old path in TEST_FILES_DELETED", async () => {
    const { diff, report } = await runCase("pass-snap-renamed");
    expect(diff).toContain(`diff --git a/${RENAMED_FROM} b/${RENAMED_TO}`);
    expect(diff).toMatch(new RegExp(`^rename from ${RENAMED_FROM.replaceAll(".", "\\.")}$`, "m"));
    expect(diff).toMatch(new RegExp(`^rename to ${RENAMED_TO.replaceAll(".", "\\.")}$`, "m"));

    expectNoSnapTi01(report);
    expectListed(report, RENAMED_FROM);
  });

  it("AC-11: a deleted snapshot whose removed lines hold a stored test( line gives no TI01 for it and is still listed in TEST_FILES_DELETED", async () => {
    const { diff, report } = await runCase("pass-snap-deleted");
    const section = diff.split(/^(?=diff --git )/m).find((p) => p.startsWith(`diff --git a/${DELETED} b/${DELETED}`));
    expect(section, "the diff deletes the snapshot").toBeDefined();
    expect(section).toMatch(/^deleted file mode/m);
    // Without the exclusion, today's TI01 would count this file: a removed line looks like a test definition.
    expect(
      (section ?? "").split("\n").some((line) => /^-(?!--).*\b(it|test|describe)\s*\(/.test(line)),
      "a removed line of the snapshot reads as a test definition",
    ).toBe(true);

    expectNoSnapTi01(report);
    expectListed(report, DELETED);
  });
});
