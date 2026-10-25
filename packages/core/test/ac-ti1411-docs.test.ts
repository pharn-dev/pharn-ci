import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
/** The commit before this increment. */
const BEFORE = "54804ba8c6e67f6bb757a97a04c1691431cd2c90";
const REPO_ROOT = "/home/runner/work/demo/demo";

const TI14 = [
  "block-threshold-lowered.diff",
  "block-threshold-removed.diff",
  "block-config-deleted.diff",
  "block-exclude-flow.diff",
  "block-exclude-block.diff",
  "block-exclude-appended.diff",
  "pass-threshold-raised.diff",
  "pass-threshold-moved.diff",
  "pass-threshold-added.diff",
  "pass-exclude-removed.diff",
  "pass-exclude-moved.diff",
  "pass-unrelated-setup.diff",
  "pass-file-item-added.diff",
];

const TI11 = [
  "block-test-step-removed.diff",
  "block-workflow-deleted.diff",
  "block-trigger-removed.diff",
  "block-trigger-flow.diff",
  "warn-matrix-reduced.diff",
  "warn-continue-on-error.diff",
  "warn-if-false.diff",
  "warn-if-event.diff",
  "warn-timeout-one.diff",
  "pass-step-moved.diff",
  "pass-step-reflowed.diff",
  "pass-comment-removed.diff",
  "pass-trigger-kept.diff",
  "pass-matrix-grown.diff",
  "pass-continue-expression.diff",
  "pass-if-always.diff",
  "pass-timeout-fifteen.diff",
  "pass-action-bump.diff",
  "pass-pure-rename.diff",
  "pass-non-workflow.diff",
];

/** The text of one `## ` or `### ` section of a markdown file, from its heading to the next heading of any level. */
function sectionOf(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^#{2,4} /.test(line) && line.includes(heading));
  if (start === -1) throw new Error(`no section "${heading}"`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{2,4} /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

async function signalsOf(dir: string, name: string, exclude: string[] = []) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: fixture(`test-integrity/${dir}/${name}`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    exclude,
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report.testIntegrity.signals.filter((signal) => String(signal.id) === dir);
}

describe("TI14 and TI11: docs, schema and fixtures", () => {
  it("AC-15: the v2 schema names both message codes and the v1 schema is byte-identical to the base commit's", () => {
    const schema = read("schema/report.v2.json");
    expect(schema).toContain("TEST_INTEGRITY_TI14");
    expect(schema).toContain("TEST_INTEGRITY_TI11");
    const before = execFileSync("git", ["show", `${BEFORE}:schema/report.v1.json`], {
      cwd: fileURLToPath(ROOT),
      encoding: "utf8",
    });
    expect(read("schema/report.v1.json")).toBe(before);
  });

  it("AC-15: the changelog, README, limits and threat model name TI14 and TI11", () => {
    // Shipped in 0.2.0; before that release its line sat under Unreleased.
    const shipped =
      read("CHANGELOG.md")
        .split(/^## \[/m)
        .find((p) => p.startsWith("0.2.0]")) ?? "";
    expect(shipped).toContain("TI14");
    expect(shipped).toContain("TI11");
    const readme = read("README.md");
    for (const word of ["TI14", "TI11", "TEST_INTEGRITY_TI14", "TEST_INTEGRITY_TI11"]) expect(readme).toContain(word);

    const limits = read("docs/LIMITS.md");
    for (const heading of ["What TI14 misses", "What TI11 misses"]) {
      const text = sectionOf(limits, heading).toLowerCase();
      expect(text, heading).toContain("context");
    }
    expect(sectionOf(limits, "What TI11 misses")).toContain("E5");
    expect(limits).toContain("5000");
    const threat = read("docs/THREAT-MODEL.md");
    expect(threat).toContain("TI14");
    expect(threat).toContain("TI11");
  });

  it("AC-15: at least five must-trigger and five must-not-trigger diffs exist for each id, and they behave", async () => {
    for (const [dir, names] of [
      ["TI14", TI14],
      ["TI11", TI11],
    ] as const) {
      const listed = readdirSync(new URL(`fixtures/test-integrity/${dir}/`, ROOT)).sort();
      for (const name of names)
        expect(existsSync(new URL(`fixtures/test-integrity/${dir}/${name}`, ROOT)), name).toBe(true);
      expect(listed.filter((n) => !n.startsWith("pass-")).length, `${dir} must-trigger`).toBeGreaterThanOrEqual(5);
      expect(listed.filter((n) => n.startsWith("pass-")).length, `${dir} must-not-trigger`).toBeGreaterThanOrEqual(5);

      for (const name of names) {
        // An item appended to an existing list is judged against the exclusion patterns the check was given.
        const appended = name === "block-exclude-appended.diff";
        const exclude = appended
          ? fixture(`test-integrity/${dir}/${name}`)
              .split("\n")
              .filter((line) => /^\+\s+- /.test(line))
              .map((line) => line.replace(/^\+\s+- /, "").replace(/^["']|["']$/g, ""))
          : [];
        const signals = await signalsOf(dir, name, exclude);
        if (name.startsWith("pass-")) expect(signals, `${dir}/${name}`).toEqual([]);
        else {
          expect(signals.length, `${dir}/${name}`).toBeGreaterThan(0);
          expect(signals[0]?.severity, `${dir}/${name}`).toBe(name.startsWith("warn-") ? "warn" : "block");
        }
      }
    }
  });
});
