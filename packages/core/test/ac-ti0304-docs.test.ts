import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
/** The commit before this increment. */
const BEFORE = "be11155dc701478902b77983a2fa7a5db358a806";
const REPO_ROOT = "/home/runner/work/demo/demo";

/** The must-not-block cases of docs/PRECISION.md §1, each a TI03 fixture whose TI03 signals are all warn or absent. */
const TI03_PRECISION = [
  "warn-conditional-mobile.diff",
  "warn-skipif-camera.diff",
  "warn-skipif-docker.diff",
  "warn-skipif-openssl.diff",
  "warn-skipunless-windows.diff",
  "warn-pytest-skip-redis.diff",
  "warn-pytest-skip-fixture.diff",
  "warn-go-skip-root.diff",
  "warn-xfail-new-test.diff",
  "pass-fails-async-edit.diff",
];

/** The PRECISION.md §1 cases TI04 must not fire on. */
const TI04_PRECISION = ["pass-solver-fit.diff", "pass-python-def-fit.diff"];

/** The text of one `## `, `### ` or `#### ` section of a markdown file, up to the next heading of any of those levels. */
function sectionOf(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^#{2,4} /.test(line) && line.includes(heading));
  if (start === -1) throw new Error(`no section "${heading}"`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{2,4} /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

async function signalsOf(dir: string, name: string) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: fixture(`test-integrity/${dir}/${name}`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report.testIntegrity.signals.filter((signal) => String(signal.id) === dir);
}

describe("TI03 and TI04: docs, schema and fixtures", () => {
  it("AC-14: the v2 schema names both message codes and the v1 schema is byte-identical to the base commit's", () => {
    const schema = read("schema/report.v2.json");
    expect(schema).toContain("TEST_INTEGRITY_TI03");
    expect(schema).toContain("TEST_INTEGRITY_TI04");
    const before = execFileSync("git", ["show", `${BEFORE}:schema/report.v1.json`], {
      cwd: fileURLToPath(ROOT),
      encoding: "utf8",
    });
    expect(read("schema/report.v1.json")).toBe(before);
  });

  it("AC-14: the changelog, README, limits and threat model name TI03 and TI04", () => {
    // Shipped in 0.2.0; before that release its line sat under Unreleased.
    const shipped =
      read("CHANGELOG.md")
        .split(/^## \[/m)
        .find((p) => p.startsWith("0.2.0]")) ?? "";
    expect(shipped).toContain("TI03");
    expect(shipped).toContain("TI04");

    const readme = read("README.md");
    for (const word of ["TI03", "TI04", "TEST_INTEGRITY_TI03", "TEST_INTEGRITY_TI04"]) expect(readme).toContain(word);

    const limits = read("docs/LIMITS.md");
    const ti03 = sectionOf(limits, "What TI03 misses");
    const ti04 = sectionOf(limits, "What TI04 misses");
    const both = `${ti03}\n${ti04}`;
    expect(ti03.toLowerCase(), "missing context lines").toContain("context");
    expect(both.toLowerCase(), "forms recognised only at the start of a line").toMatch(
      /(start|beginning) of (a|the) line|line start/,
    );
    expect(ti03, "test.fixme").toContain("test.fixme");
    expect(ti03.toLowerCase(), "Go receivers other than t").toContain("receiver");
    expect(ti03.toLowerCase(), "a skip moved to another file").toMatch(/(another|other|different) file/);
    expect(ti04, "TI04 for Python").toContain("Python");
    expect(ti04, "TI04 for Go").toMatch(/\bGo\b/);
    expect(both, "the kept-text caps").toMatch(/5[ ,]?000|\b400\b/);

    const threat = read("docs/THREAT-MODEL.md");
    expect(threat).toContain("TI03");
    expect(threat).toContain("TI04");
    const paragraph = threat.split(/\n\s*\n/).find((p) => p.includes("TI03") && p.includes("TI04")) ?? "";
    expect(paragraph.toLowerCase(), "TI03 and TI04 read the kept text of test files").toMatch(/kept|text/);
    expect(paragraph.toLowerCase(), "fixed-sentence details").toContain("fixed");
  });

  it("AC-14: at least five must-trigger and five must-not-trigger diffs per id, the PRECISION cases among them, and they behave", async () => {
    for (const [dir, precision] of [
      ["TI03", TI03_PRECISION],
      ["TI04", TI04_PRECISION],
    ] as const) {
      const folder = new URL(`fixtures/test-integrity/${dir}/`, ROOT);
      expect(existsSync(folder), dir).toBe(true);
      const listed = readdirSync(folder)
        .filter((n) => n.endsWith(".diff"))
        .sort();
      for (const name of precision) expect(listed, `${dir}/${name}`).toContain(name);
      expect(listed.filter((n) => !n.startsWith("pass-")).length, `${dir} must-trigger`).toBeGreaterThanOrEqual(5);
      expect(listed.filter((n) => n.startsWith("pass-")).length, `${dir} must-not-trigger`).toBeGreaterThanOrEqual(5);

      for (const name of listed) {
        const signals = await signalsOf(dir, name);
        const label = `${dir}/${name}`;
        if (name.startsWith("pass-")) expect(signals, label).toEqual([]);
        else if (name.startsWith("warn-")) {
          expect(signals.length, label).toBeGreaterThan(0);
          expect(
            signals.every((s) => s.severity === "warn"),
            label,
          ).toBe(true);
        } else {
          expect(signals.length, label).toBeGreaterThan(0);
          expect(
            signals.some((s) => s.severity === "block"),
            label,
          ).toBe(true);
        }
      }
    }
  });
});
