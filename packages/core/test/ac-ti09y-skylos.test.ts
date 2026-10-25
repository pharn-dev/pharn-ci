import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the Skylos sources and the docs are read inside the test body: the AC test is written before TI09 and
// fixtures/skylos-nine-sources/deselect-setting/ exist, so nothing that depends on them may run while the file loads.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const CASE = "deselect-setting";
const PATH = "vitest.config.ts";

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
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** The normalized body of the section whose `## ` heading line includes `title`, up to the next `## ` heading. */
function sectionBody(text: string, title: string): string {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const start = lines.findIndex((line) => line.startsWith("## ") && line.includes(title));
  expect(start, `the section ${title}`).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return normalize((end === -1 ? rest : rest.slice(0, end)).join("\n"));
}

describe("Skylos nine: TI09 catches deselect-setting", () => {
  it("AC-18: deselect-setting with its base and head vitest.config.ts gives a block TI09 naming test.include narrowed, and the README and docs/LIMITS.md say 7 of 9 with deselect-setting caught by TI09", async () => {
    const base = sideFiles(`${FIXTURES}skylos-nine-sources/${CASE}/base`);
    const head = sideFiles(`${FIXTURES}skylos-nine-sources/${CASE}/head`);
    expect(
      base.map((f) => f.path),
      "the base side holds vitest.config.ts",
    ).toEqual([PATH]);
    expect(
      head.map((f) => f.path),
      "the head side holds vitest.config.ts",
    ).toEqual([PATH]);
    // The sources hold the case the diff shows: the include list on line 5, narrowed at head.
    expect(base[0]?.text.split("\n")[4]).toContain('include: ["src/**/*.test.ts"]');
    expect(head[0]?.text.split("\n")[4]).toContain('include: ["src/**/*.fast.test.ts"]');

    const { check } = await import("@pharn-ci/core");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: fixture(`skylos-nine/${CASE}/change.diff`) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture(`skylos-nine/${CASE}/files.txt`).trim().split("\n"),
      testIntegrityMode: { input: "block" },
      testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
    } as unknown as Parameters<typeof check>[0]);
    expectValidReport(report);
    const signals = (report.testIntegrity.signals as unknown as Signal[]).filter((s) => String(s.id) === "TI09");
    const narrowed = signals.find((s) => s.path === PATH && s.detail.includes("test.include narrowed"));
    expect(narrowed, "a TI09 for vitest.config.ts naming test.include narrowed").toBeDefined();
    expect(narrowed?.severity).toBe("block");

    const limits = sectionBody(readFileSync(`${ROOT}docs/LIMITS.md`, "utf8"), "What test integrity does not catch");
    // 7 of 9 since the rebase onto TI06 and TI07, which each moved one more case to caught.
    expect(limits).toContain("7 of 9");
    expect(limits, "LIMITS lists deselect-setting as caught by TI09").toContain(`\`${CASE}\` — caught by TI09`);
    expect(limits, "LIMITS no longer lists deselect-setting as missed").not.toContain(`\`${CASE}\` — missed`);

    const readme = sectionBody(readFileSync(`${ROOT}README.md`, "utf8"), "Test integrity");
    expect(readme).toContain("7 of 9");
    expect(readme, "the README names deselect-setting by TI09").toContain(`\`${CASE}\` by TI09`);
  });
});
